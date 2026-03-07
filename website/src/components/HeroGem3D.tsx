'use client'

import { useRef, useState, useCallback, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'

/* ────────────────────────────────────────────────────────────────────
   HeroGem3D — Real 3D WebGL gem using the exact Mythic logo shape.

   Logo vertices (from mark.svg, 100x100 viewBox):
     Top apex:      (50, 8)
     Left girdle:   (20, 44)
     Right girdle:  (80, 44)
     Center crease: (50, 56)
     Bottom apex:   (50, 92)

   Extruded into 3D with front/back depth for a proper crystal.
   ──────────────────────────────────────────────────────────────────── */

// Build the gem geometry as a proper 3D crystal
function useGemGeometry() {
  return useMemo(() => {
    const geo = new THREE.BufferGeometry()

    // Normalized vertices (centered, scaled to ~1 unit)
    // From SVG: x=(val-50)/50, y=(50-val)/50, z=depth
    const depth = 0.4

    const top    = [0,    0.84,  0]       // (50,8)
    const fLeft  = [-0.6, 0.12,  depth]   // (20,44) front
    const fRight = [0.6,  0.12,  depth]   // (80,44) front
    const bLeft  = [-0.6, 0.12, -depth]   // (20,44) back
    const bRight = [0.6,  0.12, -depth]   // (80,44) back
    const fMid   = [0,   -0.12,  depth * 0.7]  // (50,56) front crease
    const bMid   = [0,   -0.12, -depth * 0.7]  // (50,56) back crease
    const bottom = [0,   -0.84,  0]       // (50,92)

    // Crown (upper) triangles — 8 faces
    const faces = [
      // Crown front-left
      top, fLeft, fMid,
      // Crown front-right
      top, fMid, fRight,
      // Crown back-left
      top, bMid, bLeft,
      // Crown back-right
      top, bRight, bMid,
      // Crown side left
      top, bLeft, fLeft,
      // Crown side right
      top, fRight, bRight,

      // Pavilion front-left
      bottom, fMid, fLeft,
      // Pavilion front-right
      bottom, fRight, fMid,
      // Pavilion back-left
      bottom, bLeft, bMid,
      // Pavilion back-right
      bottom, bMid, bRight,
      // Pavilion side left
      bottom, fLeft, bLeft,
      // Pavilion side right
      bottom, bRight, fRight,

      // Girdle quads (as 2 triangles each) — connect front to back
      fLeft, bLeft, fMid,
      bLeft, bMid, fMid,
      fRight, fMid, bRight,
      fMid, bMid, bRight,
    ]

    const positions = new Float32Array(faces.flat())
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeVertexNormals()

    return geo
  }, [])
}

// The 3D gem mesh
function GemMesh({ mouse }: { mouse: { x: number; y: number } }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const geo = useGemGeometry()

  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime

    // Slow auto-rotation + mouse influence
    meshRef.current.rotation.y = t * 0.3 + mouse.x * 0.5
    meshRef.current.rotation.x = Math.sin(t * 0.2) * 0.1 + mouse.y * 0.3

    // Glow follows
    if (glowRef.current) {
      glowRef.current.rotation.copy(meshRef.current.rotation)
    }
  })

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
      <group>
        {/* Main gem */}
        <mesh ref={meshRef} geometry={geo}>
          <meshPhysicalMaterial
            color="#39FF14"
            emissive="#39FF14"
            emissiveIntensity={0.15}
            metalness={0.3}
            roughness={0.15}
            transmission={0.3}
            thickness={1.5}
            ior={2.4}
            envMapIntensity={1}
            clearcoat={1}
            clearcoatRoughness={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Inner glow mesh (slightly smaller, brighter emissive) */}
        <mesh ref={glowRef} geometry={geo} scale={0.85}>
          <meshBasicMaterial
            color="#39FF14"
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Point light inside the gem */}
        <pointLight color="#39FF14" intensity={0.8} distance={3} decay={2} />
      </group>
    </Float>
  )
}

export default function HeroGem3D() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 })

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -2
    setMouse({ x, y })
  }, [])

  return (
    <div
      className="mb-10 mx-auto w-[120px] h-[120px] sm:w-[150px] sm:h-[150px] lg:w-[180px] lg:h-[180px]"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMouse({ x: 0, y: 0 })}
    >
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} color="#ffffff" />
        <directionalLight position={[-3, -2, 4]} intensity={0.5} color="#7B2FFF" />
        <pointLight position={[0, 3, 0]} intensity={0.6} color="#39FF14" />
        <pointLight position={[0, -3, 0]} intensity={0.3} color="#7B2FFF" />

        <GemMesh mouse={mouse} />
      </Canvas>
    </div>
  )
}
