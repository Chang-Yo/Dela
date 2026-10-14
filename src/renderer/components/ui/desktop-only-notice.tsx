type DesktopOnlyNoticeProps = {
  title: string;
  description: string;
};

/** 浏览器预览(无 Electron preload)时替代真实功能的静态说明。 */
export function DesktopOnlyNotice({ title, description }: DesktopOnlyNoticeProps) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="grid w-full max-w-[28.75rem] gap-2">
        <p className="text-2xs font-medium text-ink-3">浏览器预览</p>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-13 leading-relaxed text-ink-3">{description}</p>
      </div>
    </div>
  );
}
