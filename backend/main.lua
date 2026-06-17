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

    local command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' .. script_path .. '"'
    local output, status = utils.exec(command)
    if not output then
        logger:error("PowerShell command failed: " .. tostring(status))
        return nil
    end

    return utils.trim(output)
end

function sgdb_request(path)
    return request_json(path)
end

function download_as_base64(url)
    local script = table.concat({
        "$ProgressPreference = 'SilentlyContinue'",
        "$wc = [System.Net.WebClient]::new()",
        "$wc.Headers.Add('User-Agent', " .. ps_quote(USER_AGENT) .. ")",
        "$bytes = $wc.DownloadData(" .. ps_quote(url) .. ")",
        "[Convert]::ToBase64String($bytes)"
    }, "; ")

    local encoded = run_powershell(script)
    if not encoded or encoded == "" then
        logger:error("Image download/base64 conversion failed")
        return false
    end

    return encoded
end

local function steam_library_cache()
    return fs.join(millennium.steam_path(), "appcache", "librarycache")
end

function set_steam_icon_from_url(appid, url)
    local cache_dir = steam_library_cache()
    if not fs.exists(cache_dir) then
        local ok, err = fs.create_directories(cache_dir)
        if not ok then
            logger:error("Could not create Steam library cache: " .. tostring(err))
            return false
        end
    end

    local icon_path = fs.join(cache_dir, tostring(appid) .. "_icon.jpg")
    local script = table.concat({
        "$ProgressPreference = 'SilentlyContinue'",
        "$wc = [System.Net.WebClient]::new()",
        "$wc.Headers.Add('User-Agent', " .. ps_quote(USER_AGENT) .. ")",
        "$wc.DownloadFile(" .. ps_quote(url) .. ", " .. ps_quote(icon_path) .. ")",
        "Write-Output 'ok'"
    }, "; ")

    local result = run_powershell(script)
    if result ~= "ok" then
        logger:error("Icon download/write failed")
        return false
    end

    return icon_path
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
