'use client';
import { useState } from 'react';
import { Card, ErrorAlert, Loading, PageHeader, Stat, TextField } from '@/components/ui';
import { useApi } from '@/lib/api';
import { inr, todayIst } from '@/lib/format';

interface Operations {
  requestsReceived: number;
  medianFirstResponseMinutes: number | null;
  quoteConversion: number;
  workOrdersCompleted: number;
  reworkOrders: number;
  reworkRate: number;
}
interface Marketplace {
  bookingsCreated: number;
  bookingsConfirmed: number;
  grossBookingValuePaise: number;
  commissionEarnedPaise: number;
  cancellations: number;
  cancellationRate: number;
  occupancyRate: number;
  averageDailyRatePaise: number;
  requestToBookingConversion: number;
  payoutsDuePaise: number;
  payoutsDueCount: number;
  payoutsPaidPaise: number;
  payoutsPaidCount: number;
}

export default function Reports() {
  const [from, setFrom] = useState(todayIst(-30));
  const [to, setTo] = useState(todayIst(1));
  const ops = useApi<Operations>(`/admin/reports/operations?from=${from}&to=${to}`);
  const mkt = useApi<Marketplace>(`/admin/reports/marketplace?from=${from}&to=${to}`);
  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <div className="flex gap-2">
            <TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
      />
      <ErrorAlert error={ops.error ?? mkt.error} />
      {(ops.isLoading || mkt.isLoading) && <Loading />}
      {ops.data && (
        <Card title="Care operations" className="mb-6">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Requests" value={ops.data.requestsReceived} />
            <Stat label="Median first response" value={ops.data.medianFirstResponseMinutes === null ? '—' : `${ops.data.medianFirstResponseMinutes} min`} />
            <Stat label="Quote conversion" value={`${ops.data.quoteConversion}%`} />
            <Stat label="Work completed" value={ops.data.workOrdersCompleted} />
            <Stat label="Rework orders" value={ops.data.reworkOrders} />
            <Stat label="Rework rate" value={`${ops.data.reworkRate}%`} tone={ops.data.reworkRate > 10 ? 'warn' : undefined} />
          </div>
        </Card>
      )}
      {mkt.data && (
        <Card title="Stays marketplace">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Bookings created" value={mkt.data.bookingsCreated} />
            <Stat label="Confirmed" value={mkt.data.bookingsConfirmed} hint={`${mkt.data.requestToBookingConversion}% conversion`} />
            <Stat label="Gross booking value" value={inr(mkt.data.grossBookingValuePaise)} />
            <Stat label="Commission earned" value={inr(mkt.data.commissionEarnedPaise)} />
            <Stat label="Occupancy" value={`${mkt.data.occupancyRate}%`} />
            <Stat label="Average daily rate" value={inr(mkt.data.averageDailyRatePaise)} />
            <Stat label="Cancellations" value={mkt.data.cancellations} hint={`${mkt.data.cancellationRate}% of confirmed`} />
            <Stat label="Payouts due" value={inr(mkt.data.payoutsDuePaise)} hint={`${mkt.data.payoutsDueCount} payouts · ${inr(mkt.data.payoutsPaidPaise)} paid`} />
          </div>
        </Card>
      )}
    </>
  );
}
