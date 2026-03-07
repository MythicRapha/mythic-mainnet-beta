interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

export default function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="group relative bg-[#08080C] border border-white/[0.06] p-8 hover:border-mythic-violet/20 transition-colors">
      <div className="w-10 h-10 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center mb-5">
        {icon}
      </div>

      <h3 className="font-display text-[1rem] font-semibold text-white mb-2">{title}</h3>
      <p className="text-mythic-text text-[0.82rem] leading-relaxed">{description}</p>
    </div>
  )
}
