'use client'

import { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

function Crystal({ mouse }: { mouse: React.MutableRefObject<{ x: number; y: number }> }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null)

  const geometry = useMemo(() => {
    // Mythic convergence crystal — faceted diamond shape
    const geo = new THREE.BufferGeometry()
    const s = 1.0

    // Vertices: top point, upper ring (4), equator ring (4), lower ring (4), bottom point
    const vertices = new Float32Array([
      // Top apex
      0, s * 1.8, 0,
      // Upper ring
      s * 0.5, s * 0.7, s * 0.5,
      -s * 0.5, s * 0.7, s * 0.5,
      -s * 0.5, s * 0.7, -s * 0.5,
      s * 0.5, s * 0.7, -s * 0.5,
      // Equator ring (wider)
      s * 0.85, 0, s * 0.85,
      -s * 0.85, 0, s * 0.85,
      -s * 0.85, 0, -s * 0.85,
      s * 0.85, 0, -s * 0.85,
      // Lower ring
      s * 0.4, -s * 0.5, s * 0.4,
      -s * 0.4, -s * 0.5, s * 0.4,
      -s * 0.4, -s * 0.5, -s * 0.4,
      s * 0.4, -s * 0.5, -s * 0.4,
      // Bottom apex
      0, -s * 1.4, 0,
    ])

    // Face indices
    const indices = [
      // Top crown
      0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1,
      // Upper body
      1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 8, 3, 8, 4, 4, 8, 5, 4, 5, 1,
      // Lower body
      5, 9, 10, 5, 10, 6, 6, 10, 11, 6, 11, 7, 7, 11, 12, 7, 12, 8, 8, 12, 9, 8, 9, 5,
      // Bottom
      13, 10, 9, 13, 11, 10, 13, 12, 11, 13, 9, 12,
    ]

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [])

  useFrame((state) => {
    if (!meshRef.current || !glowRef.current) return
    const t = state.clock.elapsedTime

    // Smooth rotation with mouse influence
    const targetRotY = mouse.current.x * 0.3
    const targetRotX = mouse.current.y * 0.15
    meshRef.current.rotation.y += (targetRotY + t * 0.15 - meshRef.current.rotation.y) * 0.04
    meshRef.current.rotation.x += (targetRotX + Math.sin(t * 0.5) * 0.1 - meshRef.current.rotation.x) * 0.04

    // Gentle float
    meshRef.current.position.y = Math.sin(t * 0.8) * 0.08

    // Glow follows
    glowRef.current.rotation.copy(meshRef.current.rotation)
    glowRef.current.position.copy(meshRef.current.position)

    // Subtle material animation
    if (materialRef.current) {
      materialRef.current.emissiveIntensity = 0.15 + Math.sin(t * 1.5) * 0.05
    }
  })

  return (
    <>
      {/* Crystal body */}
      <mesh ref={meshRef} geometry={geometry} scale={0.65}>
        <meshPhysicalMaterial
          ref={materialRef}
          color="#7B2FFF"
          emissive="#7B2FFF"
          emissiveIntensity={0.15}
          metalness={0.1}
          roughness={0.08}
          transmission={0.4}
          thickness={1.5}
          ior={2.4}
          clearcoat={1}
          clearcoatRoughness={0.05}
          envMapIntensity={1.5}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Outer glow shell */}
      <mesh ref={glowRef} geometry={geometry} scale={0.72}>
        <meshBasicMaterial
          color="#7B2FFF"
          transparent
          opacity={0.04}
          side={THREE.BackSide}
        />
      </mesh>
    </>
  )
}

function Particles() {
  const ref = useRef<THREE.Points>(null)
  const count = 80

  const [positions, sizes] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const sz = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const r = 2 + Math.random() * 3
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i * 3 + 2] = r * Math.cos(phi)
      sz[i] = 0.5 + Math.random() * 1.5
    }
    return [pos, sz]
  }, [])

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = state.clock.elapsedTime * 0.02
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.05
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          array={sizes}
          count={count}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#7B2FFF"
        size={0.015}
        transparent
        opacity={0.5}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

function Scene({ mouse }: { mouse: React.MutableRefObject<{ x: number; y: number }> }) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} color="#ffffff" />
      <directionalLight position={[-3, 2, -4]} intensity={0.4} color="#7B2FFF" />
      <pointLight position={[0, 3, 0]} intensity={0.6} color="#9B5FFF" distance={8} />
      <pointLight position={[0, -2, 2]} intensity={0.3} color="#39FF14" distance={6} />
      <Crystal mouse={mouse} />
      <Particles />
    </>
  )
}

export default function HeroGem() {
  const mouse = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize to -1 to 1
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  if (!mounted) {
    // SSR fallback
    return (
      <div className="mb-10 flex justify-center">
        <div className="w-[120px] h-[160px]" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="mb-6 flex justify-center" style={{ height: '200px' }}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ width: '300px', height: '200px' }}
        dpr={[1, 2]}
      >
        <Scene mouse={mouse} />
      </Canvas>
    </div>
  )
}
