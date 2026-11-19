import { Search } from 'lucide-react';
import type * as React from 'react';
import { cn } from './cn';
import { Input } from './input';

function SearchInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <div className={cn('relative min-w-0', className)} data-slot="search-input">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
      />
      <Input className="pl-8" {...props} />
    </div>
  );
}

export { SearchInput };
