/**
 * Wait for real rendered frames — not milliseconds.
 *
 * A test that needs "the page has drawn" waits for frames: a loaded machine draws fewer
 * frames in the same time, so a fixed sleep can end before anything was drawn. In test mode
 * the sim doesn't tick between calls (manual clock), but the page still renders.
 */
export function frames(page, n = 3) {
  return page.evaluate(n => new Promise(done => {
    let k = 0;
    const next = () => (++k >= n ? done() : requestAnimationFrame(next));
    requestAnimationFrame(next);
  }), n);
}
