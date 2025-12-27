local local_ip = getgenv().TeleCodeIP getgenv().TeleCodeIP = nil

if not local_ip or local_ip == "" then warn("TeleCode Security: Invalid or missing IP reference.") return end

local FETCH_URL = local_ip .. "/fetch" local RETRY_DELAY = 1

local function startPolling() while true do local success, script = pcall(function() return game:HttpGet(FETCH_URL) end)

if success and script and #script > 0 then
        local func, err = loadstring(script)
        if func then
            task.spawn(func)
        else
            warn("TeleCode Script Error: " .. tostring(err))
        end
        task.wait(0.05) 
    else
        task.wait(RETRY_DELAY)
    end
end
end

task.spawn(startPolling)
