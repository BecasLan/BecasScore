// trustkit-v2/anchor.js
function buildAnchorFn(logger, cfg){
  if (!cfg?.ONCHAIN_ENABLED) {
    logger?.info?.('[TrustKit] On-chain anchor disabled.');
    return async () => {};
  }
  // Buraya zincir yazımı eklenebilir (hash-only). Şimdilik NOP.
  return async function anchorEvent(evt){
    logger?.debug?.('[TrustKit] anchor noop:', evt);
  };
}
module.exports = { buildAnchorFn };
