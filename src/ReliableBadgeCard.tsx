import {
  RELIABLE_COMPLETION_PCT,
  RELIABLE_MAX_RESPONSE_MINUTES,
  reliableProgress,
  formatResponseMinutes,
} from './reliableBadge'

/**
 * The seller's own view of the 💎 Reliable Seller badge.
 *
 * Buyers only ever see the chip on the store page; this card is for the person earning it. It
 * draws *both* numbers rachett measures — completion rate and average first reply — as bars
 * against the same goals the badge uses, so a seller can see exactly how close they are. The
 * numbers come straight from `useSellerStats` (i.e. from `sellers/{uid}/stats/main`), and the
 * goals come from `reliableBadge.ts`, the same module the badge itself is judged by — so a bar can
 * never sit full while the badge stays hidden.
 */
interface ReliableBadgeCardProps {
  realSeller: boolean
  orderCompletionRate: number | null
  completedOrders: number
  totalOrders: number
  avgResponseMinutes: number | null
}

const GREEN = '#adff2f'
const MET = '#adff2f'
const UNMET = '#ff9500'

function bar(fraction: number, met: boolean): React.CSSProperties {
  return {
    width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
    height: '100%',
    borderRadius: '999px',
    background: met ? MET : UNMET,
    transition: 'width 0.4s ease',
  }
}

function Row({
  label,
  value,
  detail,
  goal,
  met,
  fraction,
  markerAt,
}: {
  label: string
  value: string
  detail: string
  goal: string
  met: boolean
  fraction: number
  markerAt?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#ddd' }}>{label}</span>
        <span style={{ fontSize: '15px', fontWeight: 800, color: met ? MET : '#fff' }}>
          {value}
          {met && <span style={{ marginLeft: '6px' }}>✓</span>}
        </span>
      </div>
      <div style={{ position: 'relative', height: '8px', borderRadius: '999px', background: '#222', overflow: 'hidden' }}>
        <div style={bar(fraction, met)} />
        {markerAt !== undefined && (
          <span
            title="the goal"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${markerAt * 100}%`,
              width: '2px',
              background: 'rgba(255,255,255,0.55)',
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', color: '#777' }}>
        <span>{detail}</span>
        <span>{goal}</span>
      </div>
    </div>
  )
}

function ReliableBadgeCard({
  realSeller,
  orderCompletionRate,
  completedOrders,
  totalOrders,
  avgResponseMinutes,
}: ReliableBadgeCardProps) {
  const progress = reliableProgress({
    realSeller,
    orderCompletionRate,
    totalOrders,
    avgResponseMinutes,
    completedOrders,
  })

  const measured = orderCompletionRate !== null && totalOrders > 0
  const completionValue = measured ? `${orderCompletionRate}%` : '—'
  const completionDetail = measured
    ? `${completedOrders} of ${totalOrders} orders completed`
    : 'No orders yet'
  const completionFraction = measured ? (orderCompletionRate as number) / 100 : 0

  const hasResponse = avgResponseMinutes !== null
  const responseValue = hasResponse ? formatResponseMinutes(avgResponseMinutes as number) : '—'
  const responseFraction = hasResponse
    ? (RELIABLE_MAX_RESPONSE_MINUTES - (avgResponseMinutes as number)) / RELIABLE_MAX_RESPONSE_MINUTES
    : 0
  const goalMinutes: number = RELIABLE_MAX_RESPONSE_MINUTES
  const responseGoal = goalMinutes < 60
    ? `${goalMinutes} min`
    : goalMinutes === 60
      ? '1 hour'
      : `${goalMinutes / 60} hours`

  return (
    <div
      style={{
        background: '#141414',
        border: `1px solid ${progress.earned ? 'rgba(173,255,47,0.35)' : '#222'}`,
        borderRadius: '14px',
        padding: '18px 18px 20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>💎</span>
          <span style={{ fontSize: '15px', fontWeight: 800 }}>Reliable Seller</span>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: '999px',
            background: progress.earned ? GREEN : '#222',
            color: progress.earned ? '#000' : '#888',
            whiteSpace: 'nowrap',
          }}
        >
          {progress.earned ? 'Earned ✓' : 'In progress'}
        </span>
      </div>

      <p style={{ margin: '0 0 16px', color: '#888', fontSize: '12.5px', lineHeight: 1.5 }}>
        Buyers see this badge on your shop. Rachett measures two things for it — you do not apply.
      </p>

      {!progress.realSellerMet && (
        <p
          style={{
            margin: '0 0 16px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: '#1c1a12',
            border: '1px solid #3a3320',
            color: '#d9c98a',
            fontSize: '12.5px',
            lineHeight: 1.5,
          }}
        >
          🟢 Real Seller comes first — Reliable builds on it. Finish your profile (phone, location,
          a business name, a bio and one product) to start.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <Row
          label="Order completion"
          value={completionValue}
          detail={completionDetail}
          goal={`Goal: ${RELIABLE_COMPLETION_PCT}% or more`}
          met={progress.completionMet}
          fraction={completionFraction}
          markerAt={RELIABLE_COMPLETION_PCT / 100}
        />
        <Row
          label="Average first reply"
          value={responseValue}
          detail={hasResponse ? 'to your buyers' : 'No replies measured yet'}
          goal={`Goal: under ${responseGoal}`}
          met={progress.responseMet}
          fraction={responseFraction}
        />
      </div>
    </div>
  )
}

export default ReliableBadgeCard

