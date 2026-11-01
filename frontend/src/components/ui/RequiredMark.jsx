// Red asterisk for required-field labels (matches Field's `required` marker).
// Pass show={false} once the field is complete and valid.
export default function RequiredMark({ show = true }) {
  if (!show) return null;
  return <span aria-hidden="true" className="text-[#bf4a53] ml-0.5">*</span>;
}
