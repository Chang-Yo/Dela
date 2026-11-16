import { useEffect, useEffectEvent } from 'react';

const line1AtSeconds = 0.3;
const line2AtSeconds = 0.55;
const lineSeconds = 0.7;
const fadeAtSeconds = 2.9;
const fadeSeconds = 1;

export function CompletionOverlay({ onFinished }: { onFinished: () => void }) {
  const finish = useEffectEvent(onFinished);
  useEffect(() => {
    const timer = window.setTimeout(() => finish(), (fadeAtSeconds + fadeSeconds) * 1000);
    const skip = () => finish();
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-takeover grid animate-fade-out place-items-center bui-light bg-surface text-ink motion-reduce:animate-none"
      data-onboarding-completion=""
      style={{
        animationDelay: `${fadeAtSeconds}s`,
        animationDuration: `${fadeSeconds}s`,
      }}
    >
      <h1 className="px-8 text-center text-4xl leading-snug font-bold tracking-tight">
        <span
          className="block animate-rise-in motion-reduce:animate-none"
          style={{
            animationDelay: `${line1AtSeconds}s`,
            animationDuration: `${lineSeconds}s`,
          }}
        >
          The world keeps changing,
        </span>
        <span
          className="block animate-rise-in motion-reduce:animate-none"
          style={{
            animationDelay: `${line2AtSeconds}s`,
            animationDuration: `${lineSeconds}s`,
          }}
        >
          Dela always stays with you
        </span>
      </h1>
    </div>
  );
}
