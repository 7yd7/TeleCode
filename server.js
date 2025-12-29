const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const hostname = '0.0.0.0';
const port = 3000;

let pendingScript = null;
const connectedClients = new Map(); // Track connected clients: ID -> { name, userId, startTime, lastSeen, ip }

function getLocalExternalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Clean up inactive clients every 5 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of connectedClients) {
        if (now - data.lastSeen > 10000) { // 10 seconds timeout
            console.log(`[Server] Client timed out: ${data.name} (${id})`);
            connectedClients.delete(id);
        }
    }
}, 5000);

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET') {
        // Status endpoint for UI
        if (url.pathname === '/status') {
            const data = Array.from(connectedClients.values()).map(c => ({
                name: c.name,
                userId: c.userId,
                startTime: c.startTime,
                ip: c.ip
            }));

            // Log for debugging
            console.log(`[Server] Status checked. ${data.length} active clients.`);
            if (data.length > 0) {
                console.log(`[Server] Active: ${data.map(c => c.name).join(', ')}`);
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ clients: data.length, list: data }));
            return;
        }

        if (url.pathname === '/fetch') {
            // Track client by IP or UserId
            const clientIP = req.socket.remoteAddress || 'unknown';
            const name = url.searchParams.get('name') || 'Unknown';
            const userId = url.searchParams.get('userId') || '0';

            const clientKey = userId !== '0' ? userId : clientIP;

            if (!connectedClients.has(clientKey)) {
                console.log(`[Server] New client: ${name} (${userId}) from ${clientIP}`);
                connectedClients.set(clientKey, {
                    name,
                    userId,
                    startTime: Date.now(),
                    lastSeen: Date.now(),
                    ip: clientIP
                });
            } else {
                const client = connectedClients.get(clientKey);
                client.lastSeen = Date.now();
                client.name = name; // Update in case of change
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(pendingScript || '');
            if (pendingScript) {
                console.log(`[Server] Script delivered to: ${name}`);
                pendingScript = null;
            }
            return;
        }

        if (url.pathname === '/loader') {
            const host = req.headers.host || `${getLocalExternalIP()}:${port}`;
            const loader = `-- TeleCode External Loader
local HttpService = game:GetService("HttpService")
local player = game.Players.LocalPlayer
local baseUrl = "http://${host}"

local function poll()
    local success, script = pcall(function()
        local name = HttpService:UrlEncode(player.Name)
        local userId = tostring(player.UserId)
        return game:HttpGet(baseUrl .. "/fetch?name=" .. name .. "&userId=" .. userId)
    end)
    if success and script and #script > 0 then
        local func, err = loadstring(script)
        if func then
            task.spawn(func)
        else
            warn("TeleCode Load Error: " .. tostring(err))
        end
    end
end

while task.wait(0.1) do
    poll()
end`;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(loader);
            return;
        }

        // Existing file serving logic
        let filePath;
        if (req.url === '/' || req.url === '/script') {
            filePath = path.join(__dirname, 'client.luau');
        } else if (req.url.endsWith('.luau') || req.url.endsWith('.json')) {
            filePath = path.join(__dirname, req.url.slice(1));
        }

        if (filePath && fs.existsSync(filePath)) {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    res.statusCode = 500;
                    res.end('Internal Server Error');
                    return;
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain');
                res.end(data);
            });
            return;
        }
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            if (req.url === '/execute') {
                try {
                    const data = JSON.parse(body);
                    pendingScript = data.script;
                    res.statusCode = 200;
                    res.end('Script queued');
                } catch (e) {
                    res.statusCode = 400;
                    res.end('Invalid JSON');
                }
            } else if (req.url === '/log') {
                console.log('Received from Lua:', body);
                res.statusCode = 200;
                res.end('Log received');
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        });
        return;
    }

    res.statusCode = 404;
    res.end('Not Found\n');
});

// For integration with Electron
if (require.main === module) {
    server.listen(port, hostname, () => {
        const localIP = getLocalExternalIP();
        console.log(`Server running at http://${localIP}:${port}/`);
    });
}

module.exports = server;
