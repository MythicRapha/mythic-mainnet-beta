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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-mythic-border">
            <th className="text-left py-3 px-4 text-mythic-text font-medium uppercase tracking-wider text-xs">
              Fee Type
            </th>
            <th className="text-center py-3 px-4 text-mythic-text font-medium uppercase tracking-wider text-xs">
              Validators
            </th>
            <th className="text-center py-3 px-4 text-mythic-text font-medium uppercase tracking-wider text-xs">
              Foundation
            </th>
            <th className="text-center py-3 px-4 text-mythic-text font-medium uppercase tracking-wider text-xs">
              Burned
            </th>
          </tr>
        </thead>
        <tbody>
          {feeData.map((row) => (
            <tr
              key={row.type}
              className="border-b border-mythic-border/50 hover:bg-mythic-purple/5 transition-colors"
            >
              <td className="py-3 px-4 text-white font-medium">{row.type}</td>
              <td className="py-3 px-4 text-center text-mythic-cyan">{row.validators}</td>
              <td className="py-3 px-4 text-center text-mythic-text">{row.foundation}</td>
              <td className="py-3 px-4 text-center text-orange-400">{row.burned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
