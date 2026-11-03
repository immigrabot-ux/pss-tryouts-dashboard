import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const brain = JSON.parse(fs.readFileSync(process.env.HOME+'/mnt/Downloads/_pss_preview/brain.json','utf8')).prompt;
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const sys = brain + `\nTHIS CONVERSATION: WhatsApp.\n- Parent: Rosa\n- Child: Iker (age 8)\n- How they found us: a Facebook/Instagram ad form, August 2026\n- Plain text only.\nReply with only the message text.`;
const tests = ["Hi! Is the free first session still available?", "Cuánto cuesta el invierno?", "When are the tryouts? My son wants to join for spring"];
for (const t of tests) {
  for (const model of ['claude-sonnet-5-5','claude-sonnet-4-5-20250929']) {
    try { const r = await client.messages.create({model, max_tokens:300, system:sys, messages:[{role:'user',content:t}]});
      console.log(`\n[${model}] Q: ${t}\nA: ${r.content.map(b=>b.text||'').join('')}`); break;
    } catch(e){ console.log(`[${model}] error ${e.status} ${String(e.message).slice(0,120)}`); }
  }
}
