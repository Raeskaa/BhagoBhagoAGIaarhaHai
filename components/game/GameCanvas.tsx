"use client";

import { useEffect, useRef } from "react";
import type { AgentId, WorldSnapshot } from "@/lib/types";

interface GameCanvasProps {
  snapshot: WorldSnapshot;
  selectedAgentId: AgentId;
  onSelectAgent: (agentId: AgentId) => void;
}

export function GameCanvas({ snapshot, selectedAgentId, onSelectAgent }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean, noReturn?: boolean) => void; scene: { getScene: (key: string) => unknown } } | null>(null);
  const snapshotRef = useRef(snapshot);
  const selectedAgentRef = useRef(selectedAgentId);

  snapshotRef.current = snapshot;
  selectedAgentRef.current = selectedAgentId;

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (!containerRef.current || gameRef.current) return;

      const Phaser = await import("phaser");
      const { createVillageScene } = await import("../../game/scenes/VillageScene");

      if (!mounted || !containerRef.current) return;

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        width: 960,
        height: 720,
        transparent: true,
        backgroundColor: "#000000",
        scene: [
          createVillageScene({
            getSnapshot: () => snapshotRef.current,
            getSelectedAgentId: () => selectedAgentRef.current,
            onSelectAgent,
          }),
        ],
        render: {
          antialias: false,
          pixelArt: true,
        },
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      });

      gameRef.current = game;
    }

    void boot();

    return () => {
      mounted = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [onSelectAgent]);

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("village-scene") as
      | { applySnapshot?: (nextSnapshot: WorldSnapshot, nextSelectedAgentId: AgentId) => void }
      | undefined;

    scene?.applySnapshot?.(snapshot, selectedAgentId);
  }, [selectedAgentId, snapshot]);

  return <div className="game-canvas-shell" ref={containerRef} />;
}
