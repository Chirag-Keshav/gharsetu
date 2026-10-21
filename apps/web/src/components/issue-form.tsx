'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ISSUE_CATEGORIES, statusLabel } from '@propcare/shared';
import { post } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { FileUploader } from './shared';
import { Button, ErrorAlert, Form, Modal, SelectField, TextArea } from './ui';

/** "Report a problem" dialog for a booking or a work order. Opens the new issue on success. */
export function ReportIssueButton({ path, label = 'Report a problem' }: { path: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>('QUALITY');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<Array<{ id: string }>>([]);
  const { busy, error, run } = useAction();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <Form
          className="space-y-3"
          onSubmit={() =>
            run('issue', async () => {
              const issue = await post<{ id: string }>(path, { category, description, attachmentIds: files.map((f) => f.id) }, true);
              setOpen(false);
              router.push(`/issues/${issue.id}`);
            })
          }
        >
          <SelectField label="What went wrong?" value={category} onChange={(e) => setCategory(e.target.value)} options={ISSUE_CATEGORIES.map((c) => ({ value: c, label: statusLabel(c) }))} />
          <TextArea label="Describe the problem" required minLength={10} maxLength={5000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} invalidMessage="Tell us a little more (at least 10 characters)." />
          <FileUploader ownerType="ISSUE" max={10} onChange={setFiles} compact label="Add photos (optional)" />
          <ErrorAlert error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy === 'issue'}>
              Submit
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
