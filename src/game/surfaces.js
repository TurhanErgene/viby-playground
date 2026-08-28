/**
 * Surfaces are how a map's demands become physical instead of decorative.
 * Every surface is driveable — none of them stop a stock car finishing — but
 * each one punishes a different missing upgrade.
 */
export const SURFACES = {
  asphalt: { id: 'asphalt', label: 'Asphalt', gripMul: 1.00, drag: 0.0,  rough: 0.00, color: 0x5c6270, demands: null },
  gravel:  { id: 'gravel',  label: 'Gravel',  gripMul: 0.82, drag: 0.9,  rough: 0.45, color: 0x6f6353, demands: 'suspension' },
  sand:    { id: 'sand',    label: 'Sand',    gripMul: 0.70, drag: 2.6,  rough: 0.70, color: 0xb99a63, demands: 'suspension' },
  ice:     { id: 'ice',     label: 'Ice',     gripMul: 0.42, drag: -0.3, rough: 0.05, color: 0xb4d8ea, demands: 'grip' },
  water:   { id: 'water',   label: 'Standing water', gripMul: 0.60, drag: 3.4, rough: 0.25, color: 0x5b8090, demands: 'grip' },
  boost:   { id: 'boost',   label: 'Boost strip',    gripMul: 1.05, drag: -3.5, rough: 0.0, color: 0x2fd6a8, demands: null }
};

export const SURFACE_IDS = Object.keys(SURFACES);
export const surfaceOf = (id) => SURFACES[id] || SURFACES.asphalt;
