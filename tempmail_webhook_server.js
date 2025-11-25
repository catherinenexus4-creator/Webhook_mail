// Simple webhook receiver for Mailgun -> saves verification codes per local-part
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const STORE_FILE = path.join(__dirname, 'inbox_store.json');
const SECRET = process.env.WEBHOOK_SECRET || '';

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8') || '{}'); } catch (e) { return {}; }
}
function saveStore(s) { fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); }

function extractLocalPartsFromObject(obj) {
  const found = new Set();
  try {
    const combined = JSON.stringify(obj || {}).toLowerCase();
    const emails = combined.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    emails.forEach(e => {
      const local = e.split('@')[0];
      if (local) found.add(local);
    });
  } catch (e) {}
  return Array.from(found);
}

function extractCodeFromObject(obj, codeRegex = /\b\d{4,8}\b/) {
  const text = ((obj['body-plain'] || obj.body_plain || obj.plain || obj.text || '') + '\n' +
                (obj.body_html || obj.html || '') + '\n' + (obj.subject || '')).toString();
  const m = text.match(codeRegex);
  if (m) return m[0];
  return null;
}

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

app.post('/mail/webhook', (req, res) => {
  const secret = req.query.secret || '';
  if (!SECRET || secret !== SECRET) return res.status(403).send('forbidden');

  const payload = req.body || {};
  const locals = extractLocalPartsFromObject(payload);
  const code = extractCodeFromObject(payload, /\b\d{4,8}\b/);

  if (locals.length && code) {
    const store = loadStore();
    const now = new Date().toISOString();
    for (const local of locals) {
      store[local.toLowerCase()] = { code, receivedAt: now, subject: payload.subject || '', source: 'mailgun' };
    }
    saveStore(store);
    console.log('Saved code for', locals.join(','), code);
    return res.send('ok');
  }

  return res.status(204).send('no code');
});

app.get('/mail/inbox/:local', (req, res) => {
  const secretQuery = req.query.secret || '';
  if (!SECRET || secretQuery !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const local = (req.params.local || '').toLowerCase();
  const store = loadStore();
  if (store[local]) return res.json(store[local]);
  return res.status(404).json({ error: 'not found' });
});

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
