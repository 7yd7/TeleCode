const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const hostname = '0.0.0.0';
const port = 3000;

let pendingScript = null;
const connectedClients = new Map(); // Track connected clients

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
    for (const [id, lastSeen] of connectedClients) {
        if (now - lastSeen > 10000) { // 10 seconds timeout
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

    if (req.method === 'GET') {
        // Status endpoint for UI
        if (req.url === '/status') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ clients: connectedClients.size }));
            return;
        }

        if (req.url === '/fetch') {
            // Track client by IP
            const clientIP = req.socket.remoteAddress || 'unknown';
            const isNewClient = !connectedClients.has(clientIP);
            connectedClients.set(clientIP, Date.now());

            // For new clients, run autoexec scripts
            if (isNewClient && global.getAutoExecScripts) {
                const autoExecScripts = global.getAutoExecScripts();
                if (autoExecScripts.length > 0 && !pendingScript) {
                    // Combine all autoexec scripts into one
                    pendingScript = autoExecScripts.join('\n\n-- AutoExec Script --\n\n');
                }
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(pendingScript || '');
            pendingScript = null;
            return;
        }

        if (req.url === '/loader') {
            const ip = getLocalExternalIP();
            const loader = `-- External Executor Loader
local function poll()
    local success, script = pcall(function()
        return game:HttpGet("http://${ip}:${port}/fetch")
    end)
    if success and script and #script > 0 then
        local func, err = loadstring(script)
        if func then
            task.spawn(func)
        else
            warn("Failed to load script: " .. tostring(err))
        end
    end
end

while task.wait(0.05) do
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
