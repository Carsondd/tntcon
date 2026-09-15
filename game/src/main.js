/* ============================================================
   Hollow Bastion — boot and main loop
   ============================================================ */
(function (global) {
  'use strict';

  function boot() {
    global.Sprites.build();
    var canvas = document.getElementById('game');
    global.Render.init(canvas);
    var offlineReport = global.Game.init();
    global.UI.init(canvas, offlineReport);
    global.UI.resize();

    var last = performance.now(), uiAcc = 0;

    function loop(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 120) {
        // the tab was parked in the background: credit the time the way a
        // closed tab is credited, instead of losing it or fast-forwarding it.
        var report = global.Game.catchUp(Math.min(12 * 3600, dt));
        global.Game.save();
        global.UI.refreshAll();
        global.UI.showOffline(report);
      }
      if (dt > 0.25) dt = 0.25;
      var G = global.Game.state;

      if (!G.paused) {
        // higher speeds run extra fixed sub-steps so physics stays stable
        var steps = G.speed, sub = dt;
        if (steps > 1) { sub = dt; }
        for (var i = 0; i < steps; i++) global.Game.update(sub);
      }

      global.Render.frame(G, dt);
      global.UI.tick(dt);

      uiAcc += dt;
      if (uiAcc >= 0.2 || G.dirtyUI) {
        uiAcc = 0;
        if (G.dirtyUI) global.UI.refreshAll(); else global.UI.poll();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
