import type { TicketData } from "./storage.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function generateTranscript(ticket: TicketData): Buffer {
  const statusColor = ticket.status === "approved" ? "#57f287" : ticket.status === "denied" ? "#ed4245" : "#fee75c";

  const messages = ticket.messages
    .map((m) => {
      const t = new Date(m.timestamp).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      return `<div class="msg"><div class="mh"><span class="au">${esc(m.author)}</span><span class="ti">${t}</span></div><div class="co">${esc(m.content)}</div></div>`;
    })
    .join("");

  const fmt = (ts: number | string | undefined) =>
    ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Transcript</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1e1f22;color:#dcddde;font-family:'Segoe UI',sans-serif;font-size:14px}
.hd{background:#2b2d31;padding:20px 28px;border-bottom:1px solid #111}h1{font-size:18px;color:#fff;margin-bottom:8px}
.meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}.mi{background:#1e1f22;border-radius:6px;padding:6px 12px}
.ml{font-size:10px;font-weight:700;text-transform:uppercase;color:#949cf7;margin-bottom:2px}.mv{font-size:13px}
.sb{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}55;text-transform:uppercase}
.tb{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#5865f222;color:#949cf7;border:1px solid #5865f255;text-transform:uppercase}
.msgs{padding:20px 28px}.msgs h2{font-size:12px;font-weight:700;text-transform:uppercase;color:#949cf7;margin-bottom:14px;letter-spacing:.05em}
.msg{padding:8px 0;border-bottom:1px solid #2b2d31}.msg:last-child{border-bottom:none}
.mh{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}.au{font-weight:700;color:#fff}.ti{font-size:11px;color:#72767d}
.co{color:#dcddde;line-height:1.6;white-space:pre-wrap}.ft{background:#2b2d31;padding:12px 28px;font-size:11px;color:#72767d;border-top:1px solid #111}
</style></head><body>
<div class="hd"><h1>Ticket Transcript</h1>
<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
  <span class="tb">${esc(ticket.type)}</span>
  ${ticket.requestedTag ? `<span class="tb">${esc(ticket.requestedTag)}</span>` : ""}
  ${ticket.status ? `<span class="sb">${esc(ticket.status)}</span>` : ""}
</div>
<div class="meta">
  <div class="mi"><div class="ml">Opened By</div><div class="mv">&lt;@${esc(ticket.userId)}&gt;</div></div>
  ${ticket.robloxUsername ? `<div class="mi"><div class="ml">Roblox</div><div class="mv">${esc(ticket.robloxUsername)}</div></div>` : ""}
  ${ticket.requestedTag ? `<div class="mi"><div class="ml">Tag</div><div class="mv">${esc(ticket.requestedTag)}</div></div>` : ""}
  <div class="mi"><div class="ml">Opened</div><div class="mv">${fmt(ticket.openedAt)}</div></div>
  ${ticket.closedAt ? `<div class="mi"><div class="ml">Closed</div><div class="mv">${fmt(ticket.closedAt)}</div></div>` : ""}
  ${ticket.closedBy ? `<div class="mi"><div class="ml">Closed By</div><div class="mv">${esc(ticket.closedBy)}</div></div>` : ""}
  ${ticket.approvedBy ? `<div class="mi"><div class="ml">Approved By</div><div class="mv">${esc(ticket.approvedBy)}</div></div>` : ""}
</div></div>
<div class="msgs"><h2>Conversation</h2>${messages || '<p style="color:#72767d">No messages recorded.</p>'}</div>
<div class="ft">Ticket ID: ${esc(ticket.channelId)}</div>
</body></html>`;

  return Buffer.from(html, "utf-8");
}
