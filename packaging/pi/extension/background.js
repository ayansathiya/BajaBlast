// Asks the calendar whether a kitchen timer is going off, for pages that
// can't ask it themselves (an https site can't fetch http://localhost).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'timers') return false;
  fetch('http://localhost:8787/api/timers', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => {
      const now = Date.parse(j.serverNow) || Date.now();
      const ringing = (j.timers || []).some((t) => t.endsAt && t.remainingMs == null && Date.parse(t.endsAt) <= now);
      reply({ ringing });
    })
    .catch(() => reply({ ringing: false }));
  return true; // reply comes later
});
