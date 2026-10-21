import { notFound } from 'next/navigation';
import { brand } from '@/lib/brand';

const DOCS: Record<string, string> = { terms: 'Terms of use', privacy: 'Privacy notice' };

/** Placeholder legal pages: text to be supplied by counsel (SPEC §0.1, §19). */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const title = DOCS[doc];
  if (!title) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-4 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm">
        <p className="font-semibold">Placeholder — not legal text.</p>
        <p className="mt-1">
          The {title.toLowerCase()} for {brand.productName} will be provided by qualified counsel before launch, including the Digital Personal Data Protection Act, 2023 review, host and guest terms, and the AI processing notice.
        </p>
      </div>
    </div>
  );
}
