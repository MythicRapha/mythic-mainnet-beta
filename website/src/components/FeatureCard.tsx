interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

export default function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="group relative p-6 rounded-xl bg-mythic-card border border-mythic-border hover:border-mythic-purple/30 transition-all duration-300 glow-purple-hover">
      {/* Gradient top border on hover */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mythic-purple/0 to-transparent group-hover:via-mythic-purple/50 transition-all duration-300 rounded-t-xl" />

      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-mythic-purple/20 to-mythic-cyan/20 border border-mythic-purple/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>

      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-mythic-text text-sm leading-relaxed">{description}</p>
    </div>
  )
}
