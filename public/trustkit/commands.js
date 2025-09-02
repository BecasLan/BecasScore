// trustkit/commands.js
class TrustCommands {
  constructor(store, logger, cfg) { this.store=store; this.logger=logger; this.cfg=cfg; }

  async tryHandle(message){
    const t = (message.content||'').trim();
    if (!t) return false;

    // !trust report 50
    let m = t.match(/^!trust\s+report(?:\s+(\d+))?$/i);
    if (m){
      const limit = Math.max(5, Math.min(200, parseInt(m[1]||'30',10)));
      const gid = message.guild?.id;
      const rows = this.store.history(gid, message.author.id, limit) || [];
      const top = rows.slice(-limit);
      const buckets = {};
      for (const r of top){
        const tags = (Array.isArray(r.tags)? r.tags : []).map(x=>String(x));
        for (const tg of tags){
          const key = tg.split('(')[0];
          buckets[key] = (buckets[key]||0)+1;
        }
      }
      const summary = Object.entries(buckets).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}: ${v}`).join(', ') || '(boş)';
      await message.reply(`📊 Son ${limit} olay özeti: ${summary}`);
      return true;
    }

    return false;
  }
}
module.exports = { TrustCommands };
