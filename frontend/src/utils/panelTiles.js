// Desktop (lg+) photo-tile grid for item lists inside side panels (cleaning
// queue, smart lists). Short lists get fewer, larger tiles whose rows stretch
// to the panel's height, so one or two items never sit over an empty panel;
// longer lists fall back to three portrait tiles per row and scroll.
// Every class is lg-only, so phones and tablets keep their row list.
const COLS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' };

export function panelTiles(count) {
  const cols = Math.max(1, Math.min(3, count));
  // Up to two rows fill the height; more rows keep the portrait ratio.
  const fill = count <= 6;
  return {
    grid: `space-y-2.5 lg:space-y-0 lg:grid lg:gap-4 ${COLS[cols]} ${fill ? 'lg:min-h-full lg:auto-rows-fr' : ''}`,
    tile: 'relative lg:flex-col lg:items-stretch lg:gap-0 lg:p-0 lg:overflow-hidden',
    // The photo sits in a frame: the frame stretches (or keeps 4:5) and the
    // image is absolutely positioned inside it, so its natural height can't
    // push the row taller than the panel.
    frame: `flex shrink-0 lg:relative lg:w-full ${fill ? 'lg:flex-1 lg:min-h-[10rem]' : 'lg:aspect-[4/5]'}`,
    img: 'lg:absolute lg:inset-0 lg:w-full lg:h-full lg:rounded-none',
    text: 'lg:px-3.5 lg:py-3 lg:flex-none',
  };
}
