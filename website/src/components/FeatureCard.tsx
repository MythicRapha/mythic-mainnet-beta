'use client'

import { motion } from 'framer-motion'

interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

export default function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4, borderColor: 'rgba(123, 47, 255, 0.3)' }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="group relative bg-[#08080C] border border-white/[0.06] p-8 transition-shadow hover:shadow-violet"
    >
      {/* Hover glow line at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-mythic-violet/0 to-transparent group-hover:via-mythic-violet/50 transition-all duration-500" />

      <div className="w-10 h-10 bg-mythic-violet/10 border border-mythic-violet/20 flex items-center justify-center mb-5 group-hover:bg-mythic-violet/20 transition-colors duration-300">
        {icon}
      </div>

      <h3 className="font-display text-[1rem] font-semibold text-white mb-2">{title}</h3>
      <p className="text-mythic-text text-[0.82rem] leading-relaxed">{description}</p>
    </motion.div>
  )
}
