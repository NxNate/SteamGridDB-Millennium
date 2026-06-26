local http = require("http")
local logger = require("logger")
local millennium = require("millennium")
local utils = require("utils")
local fs = require("fs")

local SGDB_API_BASE = "https://www.steamgriddb.com/api/v2"
local SGDB_API_KEY = "e6e64699762c2129f481a910336af00a"
local USER_AGENT = "steamgriddb-millennium/0.1.0"

local function join_url(path)
    if string.sub(path, 1, 1) == "/" then
        return SGDB_API_BASE .. path
    end
    return SGDB_API_BASE .. "/" .. path
end

local function request_json(path)
    local res, err = http.get(join_url(path), {
        headers = {
            ["Accept"] = "application/json",
            ["Authorization"] = "Bearer " .. SGDB_API_KEY,
        },
        timeout = 30,
        user_agent = USER_AGENT,
    })

    if not res then
        logger:error("SteamGridDB request failed: " .. tostring(err))
        return false
    end

    return res.body
end

local function ps_quote(value)
    return "'" .. string.gsub(tostring(value), "'", "''") .. "'"
end

local function run_powershell(script)
    local temp_dir = utils.getenv("TEMP") or utils.getenv("TMP") or utils.get_backend_path()
    local script_path = fs.join(temp_dir, "steamgriddb-millennium-" .. utils.uuid() .. ".ps1")
    local ok, write_err = utils.write_file(script_path, script)
    if not ok then
        logger:error("Could not write PowerShell helper: " .. tostring(write_err))
        return nil
    end

    local command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' .. script_path .. '"'
    local output, status = utils.exec(command)
    if not output then
        logger:error("PowerShell command failed: " .. tostring(status))
        return nil
    end

    return utils.trim(output)
end

local function json_escape(value)
    value = tostring(value or "")
    value = string.gsub(value, "\\", "\\\\")
    value = string.gsub(value, "\"", "\\\"")
    value = string.gsub(value, "\r", "\\r")
    value = string.gsub(value, "\n", "\\n")
    return value
end

function sgdb_request(path)
    return request_json(path)
end

function download_as_base64(url)
    local temp_dir = utils.getenv("TEMP") or utils.getenv("TMP") or utils.get_backend_path()
    local output_path = fs.join(temp_dir, "steamgriddb-millennium-asset-" .. utils.uuid() .. ".b64")
    local script = table.concat({
        "$ProgressPreference = 'SilentlyContinue'",
        "$wc = [System.Net.WebClient]::new()",
        "$wc.Headers.Add('User-Agent', " .. ps_quote(USER_AGENT) .. ")",
        "$bytes = $wc.DownloadData(" .. ps_quote(url) .. ")",
        "[System.IO.File]::WriteAllText(" .. ps_quote(output_path) .. ", [Convert]::ToBase64String($bytes))",
        "Write-Output 'ok'"
    }, "; ")

    local result = run_powershell(script)
    if result ~= "ok" then
        logger:error("Image download/base64 conversion failed")
        return false
    end

    local handle = io.open(output_path, "rb")
    if not handle then
        logger:error("Could not read base64 output file")
        return false
    end

    local encoded = handle:read("*a")
    handle:close()
    os.remove(output_path)

    if not encoded or encoded == "" then
        logger:error("Base64 output file was empty")
        return false
    end

    return encoded
end

local function steam_library_cache()
    return fs.join(millennium.steam_path(), "appcache", "librarycache")
end

function set_steam_icon_from_url(appid, url, extension)
    if type(appid) == "table" then
        local params = appid
        appid = params.appid
        url = params.url
        extension = params.extension
    end

    local cache_dir = steam_library_cache()

    url = tostring(url or "")
    extension = tostring(extension or ""):lower()
    if string.match(extension, "^https?://") then
        url = extension
        extension = ""
    end
    if not string.match(url, "^https?://") then
        logger:error("Icon download/write failed: invalid icon URL: " .. tostring(url))
        return false
    end
    if extension == "" then
        extension = string.match(url, "%.([A-Za-z0-9]+)%??[^/]*$") or "png"
        extension = tostring(extension):lower()
    end

    local steam_path = millennium.steam_path()
    local userdata_path = fs.join(steam_path, "userdata")
    if not fs.exists(userdata_path) then
        logger:error("Steam userdata folder was not found: " .. tostring(userdata_path))
        return false
    end

    local base_name = tostring(appid) .. "_icon"
    local file_name = base_name .. "." .. extension
    local icon_path = fs.join(cache_dir, file_name)
    local app_cache_dir = fs.join(cache_dir, tostring(appid))
    local script = table.concat({
        "try {",
        "$ProgressPreference = 'SilentlyContinue'",
        "$ErrorActionPreference = 'Stop'",
        "$userdata = " .. ps_quote(userdata_path),
        "$baseName = " .. ps_quote(base_name),
        "$fileName = " .. ps_quote(file_name),
        "$cacheDir = " .. ps_quote(cache_dir),
        "$cacheTarget = " .. ps_quote(icon_path),
        "$appCacheDir = " .. ps_quote(app_cache_dir),
        "$wc = [System.Net.WebClient]::new()",
        "$wc.Headers.Add('User-Agent', " .. ps_quote(USER_AGENT) .. ")",
        "$bytes = $wc.DownloadData(" .. ps_quote(url) .. ")",
        "$gridDirs = Get-ChildItem -LiteralPath $userdata -Directory | ForEach-Object { Join-Path $_.FullName 'config\\grid' }",
        "$written = @()",
        "foreach ($gridDir in $gridDirs) {",
        "  if (!(Test-Path -LiteralPath $gridDir)) { New-Item -ItemType Directory -Force -Path $gridDir | Out-Null }",
        "  Get-ChildItem -LiteralPath $gridDir -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq $baseName } | Remove-Item -Force -ErrorAction SilentlyContinue",
        "  $target = Join-Path $gridDir $fileName",
        "  [System.IO.File]::WriteAllBytes($target, $bytes)",
        "  $written += $target",
        "}",
        "if (Test-Path -LiteralPath $cacheDir) {",
        "  [System.IO.File]::WriteAllBytes($cacheTarget, $bytes)",
        "  $written += $cacheTarget",
        "}",
        "if (Test-Path -LiteralPath $appCacheDir) {",
        "  $rootIconTargets = Get-ChildItem -LiteralPath $appCacheDir -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -match '^[a-fA-F0-9]{40}$' -and $_.Extension -match '^\\.(jpg|jpeg|png|ico)$' }",
        "  foreach ($targetFile in $rootIconTargets) {",
        "    [System.IO.File]::WriteAllBytes($targetFile.FullName, $bytes)",
        "    $written += $targetFile.FullName",
        "  }",
        "}",
        "if ($written.Count -eq 0) { throw 'No Steam grid folders were available.' }",
        "Write-Output ($written -join '|')",
        "} catch { Write-Output ('ERROR: ' + $_.Exception.Message); exit 1 }"
    }, "; ")

    local result = run_powershell(script)
    if not result or result == "" then
        logger:error("Icon download/write failed")
        return false
    end
    if string.sub(result, 1, 7) == "ERROR: " then
        logger:error("Icon download/write failed: " .. string.sub(result, 8))
        return false
    end

    return result
end

function set_animated_artwork_from_url(appid, asset_type, url, extension)
    if type(appid) == "table" then
        local params = appid
        appid = params.appid
        asset_type = params.asset_type
        url = params.url
        extension = params.extension
    end

    local suffixes = {
        grid_p = "p",
        grid_l = "",
        hero = "_hero",
        logo = "_logo",
    }
    local suffix = suffixes[asset_type]
    if not suffix then
        logger:error("Unsupported animated artwork type: " .. tostring(asset_type))
        return false
    end

    url = tostring(url or "")
    extension = tostring(extension or ""):lower()

    if string.match(extension, "^https?://") then
        url = extension
        extension = ""
    end

    if extension == "" then
        extension = string.match(url, "%.([A-Za-z0-9]+)%??[^/]*$") or "webp"
        extension = tostring(extension):lower()
    end

    -- SGDBoop intentionally stores WebP payloads with a .png filename because
    -- Steam ignores custom artwork files with a .webp extension.
    local file_extension = extension
    if file_extension == "webp" then
        file_extension = "png"
    end

    local steam_path = millennium.steam_path()
    local userdata_path = fs.join(steam_path, "userdata")
    if not fs.exists(userdata_path) then
        logger:error("Steam userdata folder was not found: " .. tostring(userdata_path))
        return false
    end

    local base_name = tostring(appid) .. suffix
    local file_name = base_name .. "." .. file_extension
    local script = table.concat({
        "$ProgressPreference = 'SilentlyContinue'",
        "$ErrorActionPreference = 'Stop'",
        "$userdata = " .. ps_quote(userdata_path),
        "$url = " .. ps_quote(url),
        "$fileName = " .. ps_quote(file_name),
        "$baseName = " .. ps_quote(base_name),
        "$wc = [System.Net.WebClient]::new()",
        "$wc.Headers.Add('User-Agent', " .. ps_quote(USER_AGENT) .. ")",
        "$bytes = $wc.DownloadData($url)",
        "$gridDirs = Get-ChildItem -LiteralPath $userdata -Directory | ForEach-Object { Join-Path $_.FullName 'config\\grid' }",
        "$written = @()",
        "foreach ($gridDir in $gridDirs) {",
        "  if (!(Test-Path -LiteralPath $gridDir)) { New-Item -ItemType Directory -Force -Path $gridDir | Out-Null }",
        "  Get-ChildItem -LiteralPath $gridDir -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq $baseName } | Remove-Item -Force -ErrorAction SilentlyContinue",
        "  $target = Join-Path $gridDir $fileName",
        "  [System.IO.File]::WriteAllBytes($target, $bytes)",
        "  $written += $target",
        "}",
        "if ($written.Count -eq 0) { throw 'No Steam grid folders were available.' }",
        "Write-Output ($written -join '|')"
    }, "; ")

    local result = run_powershell(script)
    if not result or result == "" then
        logger:error("Animated artwork direct write failed")
        return false
    end

    return result
end

function get_current_artwork(appid)
    appid = tostring(appid or "")
    if appid == "" then
        return "{}"
    end

    local steam_path = millennium.steam_path()
    local userdata_path = fs.join(steam_path, "userdata")
    if not fs.exists(userdata_path) then
        return "{}"
    end

    local function asset_key(stem)
        if stem == appid .. "p" then
            return "grid_p"
        end
        if stem == appid then
            return "grid_l"
        end
        if stem == appid .. "_hero" then
            return "hero"
        end
        if stem == appid .. "_logo" then
            return "logo"
        end
        if stem == appid .. "_icon" then
            return "icon"
        end
        return nil
    end

    local function mime_for(ext)
        ext = string.lower(tostring(ext or ""))
        if ext == ".jpg" or ext == ".jpeg" then
            return "image/jpeg"
        end
        if ext == ".png" then
            return "image/png"
        end
        if ext == ".webp" then
            return "image/webp"
        end
        if ext == ".gif" then
            return "image/gif"
        end
        if ext == ".ico" then
            return "image/x-icon"
        end
        return "application/octet-stream"
    end

    local found = {}
    local function remember_artwork(key, file_entry)
        if not key or not file_entry or not file_entry.path then
            return
        end

        local modified = fs.last_write_time(file_entry.path) or 0
        if not found[key] or modified > found[key].modified_sort then
            local length = fs.file_size(file_entry.path) or file_entry.size or 0
            found[key] = {
                path = file_entry.path,
                modified = tostring(modified),
                modified_sort = modified,
                length = length,
                extension = fs.extension(file_entry.path) or "",
            }
        end
    end

    local users = fs.list(userdata_path) or {}
    for _, user_entry in ipairs(users) do
        if user_entry.is_directory then
            local grid_dir = fs.join(user_entry.path, "config", "grid")
            if fs.exists(grid_dir) then
                local files = fs.list(grid_dir) or {}
                for _, file_entry in ipairs(files) do
                    if file_entry.is_file then
                        local stem = fs.stem(file_entry.path)
                        local key = asset_key(stem)
                        if key then
                            remember_artwork(key, file_entry)
                        end
                    end
                end
            end
        end
    end

    local cache_dir = steam_library_cache()
    if fs.exists(cache_dir) then
        local fallback_stems = {
            [appid .. "_library_600x900"] = "grid_p",
            [appid .. "_library_600x900_2x"] = "grid_p",
            [appid .. "_portrait"] = "grid_p",
            [appid .. "_header"] = "grid_l",
            [appid .. "_library_header"] = "grid_l",
            [appid .. "_library_hero"] = "hero",
            [appid .. "_hero"] = "hero",
            [appid .. "_logo"] = "logo",
            [appid .. "_icon"] = "icon",
        }

        local app_cache_dir = fs.join(cache_dir, appid)
        local function cache_asset_key(file_entry, in_app_cache_root)
            local stem = fs.stem(file_entry.path)
            local name = string.lower(tostring(file_entry.name or stem or ""))
            local ext = string.lower(tostring(fs.extension(file_entry.path) or ""))

            if name == "library_capsule.jpg" or name == "library_600x900.jpg" or name == "portrait.jpg" then
                return "grid_p"
            end
            if name == "library_header.jpg" or name == "header.jpg" then
                return "grid_l"
            end
            if name == "library_hero.jpg" or name == "hero.jpg" then
                return "hero"
            end
            if name == "logo.png" or name == "logo.jpg" then
                return "logo"
            end
            if in_app_cache_root and (ext == ".jpg" or ext == ".png" or ext == ".ico") then
                return "icon"
            end

            return fallback_stems[stem]
        end

        local function scan_cache_directory(directory, in_app_cache_root)
            local entries = fs.list(directory) or {}
            for _, entry in ipairs(entries) do
                if entry.is_file then
                    local key = cache_asset_key(entry, in_app_cache_root)
                    if key and not found[key] then
                        remember_artwork(key, entry)
                    end
                elseif entry.is_directory then
                    scan_cache_directory(entry.path, false)
                end
            end
        end

        if fs.exists(app_cache_dir) then
            scan_cache_directory(app_cache_dir, true)
        end

        local cache_files = fs.list(cache_dir) or {}
        for _, file_entry in ipairs(cache_files) do
            if file_entry.is_file then
                local stem = fs.stem(file_entry.path)
                local key = fallback_stems[stem]
                if key and not found[key] then
                    remember_artwork(key, file_entry)
                end
            end
        end
    end

    local order = { "grid_p", "grid_l", "hero", "logo", "icon" }
    local parts = {}
    for _, key in ipairs(order) do
        local item = found[key]
        if item then
            local fields = {
                '"path":"' .. json_escape(item.path) .. '"',
                '"modified":"' .. json_escape(item.modified) .. '"',
                '"length":' .. tostring(item.length or 0),
            }

            table.insert(parts, '"' .. key .. '":{' .. table.concat(fields, ",") .. "}")
        end
    end

    return "{" .. table.concat(parts, ",") .. "}"
end

function open_external_url(url)
    if type(url) ~= "string" or not string.match(url, "^https://www%.steamgriddb%.com/") then
        logger:error("Refusing to open non-SteamGridDB URL: " .. tostring(url))
        return false
    end

    local script = "Start-Process " .. ps_quote(url) .. "; Write-Output 'ok'"
    local result = run_powershell(script)
    return result == "ok"
end

local function on_load()
    logger:info("SteamGridDB Millennium backend loaded")
    millennium.ready()
end

local function on_unload()
    logger:info("SteamGridDB Millennium backend unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
