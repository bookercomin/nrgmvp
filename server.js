const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3000;

function loadEnvFile() {
  const candidates = ['.env', 'api.env'];
  for (const fileName of candidates) {
    const envPath = path.join(__dirname, fileName);
    if (!fs.existsSync(envPath)) {
      continue;
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
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function getProvider() {
  loadEnvFile();
  return (process.env.API_PROVIDER || 'groq').toLowerCase();
}

function getApiKey(provider) {
  loadEnvFile();
  if (provider === 'groq') {
    return process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  }

  if (provider === 'gemini') {
    return process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  }

  return process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
}

function parseQuestions(content) {
  const trimmed = String(content || '[]').trim();

  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall back to line-based parsing
    }
  }

  return trimmed
    .replace(/```json|```/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('[') && !line.startsWith(']'));
}

async function callProvider(provider, apiKey, notes) {
  const prompt = `Generate 5 questions based on these notes. Return a JSON array of strings only.\n\n${notes}`;

  if (provider === 'gemini') {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Gemini request failed');
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    return parseQuestions(content);
  }

  if (provider === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You generate a fixed list of interview-style questions based on the provided notes. Return only a JSON array of strings.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Groq request failed');
    }

    const content = data.choices?.[0]?.message?.content || '[]';
    return parseQuestions(content);
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
          content: prompt
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'OpenAI request failed');
  }

  const content = data.choices?.[0]?.message?.content || '[]';
  return parseQuestions(content);
}

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
    sendJson(res, 200, { ok: true, provider: getProvider() });
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

        const provider = getProvider();
        const apiKey = getApiKey(provider);

        if (!apiKey) {
          sendJson(res, 500, { error: `${provider.toUpperCase()}_API_KEY is not set` });
          return;
        }

        const questions = await callProvider(provider, apiKey, notes);
        sendJson(res, 200, { questions });
      } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: error.message || 'Server error' });
      }
    });

    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
