import { Inject, Injectable } from '@nestjs/common';
import type { Invoice } from '@prisma/client';
import { brandFromEnv, formatInr } from '@propcare/shared';
import PDFDocument from 'pdfkit';
import { OBJECT_STORAGE, type ObjectStorage } from '../../adapters/storage';
import { isAdmin, type UserActor } from '../../core/context';
import { notFound } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { decodeCursor, iso, num, toPage } from '../../core/serialize';

const brand = brandFromEnv(process.env);

/**
 * Receipts and invoices (SPEC §8.9 INV-01). The PDF layout, numbering and GST treatment are
 * Business-pending: documents carry a visible placeholder notice.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  serialize(i: Invoice) {
    return {
      id: i.id,
      reference: i.reference,
      kind: i.kind,
      invoiceNumber: i.invoiceNumber,
      amountPaise: num(i.amountPaise),
      lines: i.lines,
      issuedAt: iso(i.issuedAt),
      bookingId: i.bookingId,
      requestId: i.requestId,
      workOrderId: i.workOrderId,
      status: i.status,
      createdAt: iso(i.issuedAt),
    };
  }

  private async visible(actor: UserActor, id: string) {
    const i = await this.prisma.invoice.findUnique({ where: { id } });
    if (!i || (!isAdmin(actor) && i.recipientUserId !== actor.userId)) throw notFound();
    return i;
  }

  async list(actor: UserActor, cursor: string | undefined, limit: number) {
    const c = decodeCursor(cursor);
    const rows = await this.prisma.invoice.findMany({
      where: {
        recipientUserId: actor.userId,
        ...(c ? { OR: [{ issuedAt: { lt: c.createdAt } }, { issuedAt: c.createdAt, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toPage(rows.map((r) => ({ ...r, createdAt: r.issuedAt })), limit, (r) => this.serialize(r));
  }

  async get(actor: UserActor, id: string) {
    return this.serialize(await this.visible(actor, id));
  }

  async downloadUrl(actor: UserActor, id: string) {
    const invoice = await this.visible(actor, id);
    let key = invoice.documentKey;
    if (!key) {
      key = `invoices/${invoice.issuedAt.getUTCFullYear()}/${invoice.id}.pdf`;
      const recipient = await this.prisma.user.findUnique({ where: { id: invoice.recipientUserId }, select: { fullName: true } });
      await this.storage.put('private', key, await this.render(invoice, recipient?.fullName ?? ''), 'application/pdf');
      await this.prisma.invoice.update({ where: { id }, data: { documentKey: key } });
    }
    return { url: await this.storage.presignDownload(key, 300, `${invoice.reference}.pdf`), expiresInSeconds: 300 };
  }

  render(invoice: Invoice, recipientName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const inr = (p: number) => formatInr(p, { withPaise: true }).replace('₹', 'INR ');
      doc.fontSize(18).text(brand.productName);
      doc.fontSize(9).fillColor('#555').text(brand.legalEntityName).text(brand.supportEmail);
      doc.moveDown();
      doc.fillColor('#000').fontSize(14).text(invoice.kind.replace(/_/g, ' '));
      doc.fontSize(10).text(`Number: ${invoice.invoiceNumber}`);
      doc.text(`Issued: ${invoice.issuedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
      if (recipientName) doc.text(`Billed to: ${recipientName}`);
      doc.moveDown();
      const lines = (invoice.lines as Array<{ label: string; amountPaise: number }>) ?? [];
      for (const l of lines) doc.text(`${l.label}`, { continued: true }).text(inr(l.amountPaise), { align: 'right' });
      doc.moveDown().fontSize(12).text('Total paid', { continued: true }).text(inr(num(invoice.amountPaise)), { align: 'right' });
      doc.moveDown(2).fontSize(8).fillColor('#a00').text(
        'PLACEHOLDER DOCUMENT — numbering, GST treatment and layout are pending accountant review. Not a tax invoice.',
      );
      doc.end();
    });
  }
}
