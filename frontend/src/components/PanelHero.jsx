import ItemImage from './ItemImage';

// Desktop-only (lg+) left column for side panels about one item: the photo
// fills the column's height, with an optional caption underneath. Render it
// as the first child of a `.panel-split` (index.css); phones and tablets
// never see it, so their layout is unchanged.
export default function PanelHero({ image, alt, eyebrow, title, badge, children }) {
  return (
    <div className="hidden lg:flex panel-col">
      <div className="panel-grow relative rounded-2xl overflow-hidden bg-gray-100 min-h-[18rem]">
        <ItemImage image={image} alt={alt ?? title ?? ''} eager className="absolute inset-0 w-full h-full object-cover" placeholderSize={48} />
        {badge}
      </div>
      {(eyebrow || title || children) && (
        <div>
          {eyebrow && <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{eyebrow}</p>}
          {title && <p className="font-bold text-gray-900">{title}</p>}
          {children}
        </div>
      )}
    </div>
  );
}
