interface FeeRow {
  type: string
  validators: string
  foundation: string
  burned: string
}

const feeData: FeeRow[] = [
  { type: 'Gas Fees', validators: '60%', foundation: '10%', burned: '30%' },
  { type: 'Compute Fees', validators: '50%', foundation: '10%', burned: '40%' },
  { type: 'AI Inference', validators: '55%', foundation: '10%', burned: '35%' },
  { type: 'Bridge Fees', validators: '40%', foundation: '20%', burned: '40%' },
]

export default function TokenomicsTable() {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="text-left py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">
              Fee Type
            </th>
            <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">
              Validators
            </th>
            <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">
              Foundation
            </th>
            <th className="text-center py-3.5 px-4 font-mono text-[0.6rem] tracking-[0.15em] uppercase text-mythic-text-muted font-medium">
              Burned
            </th>
          </tr>
        </thead>
        <tbody>
          {feeData.map((row) => (
            <tr
              key={row.type}
              className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-3.5 px-4 text-white text-[0.82rem] font-medium">{row.type}</td>
              <td className="py-3.5 px-4 text-center text-mythic-violet text-[0.82rem]">{row.validators}</td>
              <td className="py-3.5 px-4 text-center text-mythic-text text-[0.82rem]">{row.foundation}</td>
              <td className="py-3.5 px-4 text-center text-mythic-amber text-[0.82rem]">{row.burned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
