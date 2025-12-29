local local_ip = getgenv().TeleCodeIP 
getgenv().TeleCodeIP = nil

if not local_ip or local_ip == "" then 
    warn("TeleCode Security: Invalid or missing IP reference.") 
    return 
end

-- Robust URL formatting
if not string.find(local_ip, "http://") and not string.find(local_ip, "https://") then
    local_ip = "http://" .. local_ip
end

local HttpService = game:GetService("HttpService")
local player = game.Players.LocalPlayer
local RETRY_DELAY = 1

local function startPolling() 
    while true do 
        local success, script = pcall(function() 
            local name = HttpService:UrlEncode(player.Name)
            local userId = tostring(player.UserId)
            local url = local_ip .. "/fetch?name=" .. name .. "&userId=" .. userId
            return game:HttpGet(url) 
        end)

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