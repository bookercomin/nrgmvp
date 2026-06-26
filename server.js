const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3000;

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    const value = rawValueParts.join('=').trim().replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/api/generate-questions') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const { notes } = JSON.parse(body || '{}');

        if (!notes) {
          sendJson(res, 400, { error: 'Missing notes' });
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          sendJson(res, 500, { error: 'OPENAI_API_KEY is not set' });
          return;
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
              {
                role: 'system',
                content: 'You generate a fixed list of interview-style questions based on the provided notes. Return only a JSON array of strings.'
              },
              {
                role: 'user',
                content: `Generate 5 questions based on these notes. Return valid JSON like ["question 1", "question 2", "question 3", "question 4", "question 5"]:\n\n${notes}`
              }
            ]
          })
        });

        const data = await response.json();

        if (!response.ok) {
          sendJson(res, response.status, { error: data.error || 'OpenAI request failed' });
          return;
        }

        const content = data.choices?.[0]?.message?.content || '[]';
        let questions = [];

        try {
          questions = JSON.parse(content);
        } catch {
          questions = content.split('\n').filter(Boolean);
        }

        sendJson(res, 200, { questions });
      } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: 'Server error' });
      }
    });

    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
