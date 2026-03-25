import * as Phaser from "phaser";
import { MAP_HEIGHT, MAP_WIDTH, baseMapRows } from "@/lib/constants/map";
import type { AgentId, WorldSnapshot } from "@/lib/types";

type SceneDeps = {
  getSnapshot: () => WorldSnapshot;
  getSelectedAgentId: () => AgentId;
  onSelectAgent: (agentId: AgentId) => void;
};

type Facing = "left" | "right";
type AnimMode = "idle" | "walk";

type AgentSpriteBundle = {
  body: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  bobTween?: Phaser.Tweens.Tween;
  bubble?: Phaser.GameObjects.Container;
  bubbleTimer?: Phaser.Time.TimerEvent;
  facing: Facing;
  animMode: AnimMode;
  lastLine?: string;
};

type PickupBundle = {
  dot: Phaser.GameObjects.Arc;
};

const TILE = 32;
const OFFSET_X = 32;
const OFFSET_Y = 32;

const agentTitles: Record<AgentId, string> = {
  reed: "Modi",
  loom: "Rahul",
  clerk: "Mahesh",
  hammer: "Mola",
  witness: "Beggar",
  whisper: "Whisper",
};

const moveTempo: Record<AgentId, number> = {
  reed: 240,
  loom: 210,
  clerk: 290,
  hammer: 180,
  witness: 260,
  whisper: 225,
};

const spriteAssetPath: Record<AgentId, string> = {
  reed: "/sprites/reed-strip.svg",
  loom: "/sprites/loom-strip.svg",
  clerk: "/sprites/clerk-strip.svg",
  hammer: "/sprites/hammer-strip.svg",
  witness: "/sprites/witness-strip.svg",
  whisper: "/sprites/clerk-strip.svg",
};

function spriteSheetKey(agentId: AgentId) {
  return `sheet-${agentId}`;
}

function idleAnimKey(agentId: AgentId) {
  return `idle-${agentId}`;
}

function walkAnimKey(agentId: AgentId) {
  return `walk-${agentId}`;
}

function worldToScreen(x: number, y: number) {
  return {
    x: OFFSET_X + x * TILE + TILE / 2,
    y: OFFSET_Y + y * TILE + TILE / 2,
  };
}

function moodTint(mood: string) {
  if (mood === "cold") return 0x8ec5ff;
  if (mood === "hungry") return 0xffc27a;
  if (mood === "uneasy") return 0xd7c2ff;
  if (mood === "resolute") return 0xff826f;
  return 0xffffff;
}

function recentSpeechForAgent(snapshot: WorldSnapshot, agentId: AgentId) {
  const thread = snapshot.chatThreads.find((entry) => entry.messages.some((msg) => msg.authorId === agentId));
  const message = thread?.messages.find((entry) => entry.authorId === agentId && entry.kind === "speech");
  return message?.text ?? null;
}

function recentThoughtForAgent(snapshot: WorldSnapshot, agentId: AgentId) {
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) return null;
  if (agent.currentAction !== "think" && agent.currentAction !== "reflect") return null;
  return agent.lastThought;
}

function ensureAnimations(scene: Phaser.Scene, agentId: AgentId) {
  const idleKey = idleAnimKey(agentId);
  const walkKey = walkAnimKey(agentId);
  const sheetKey = spriteSheetKey(agentId);

  if (!scene.anims.exists(idleKey)) {
    scene.anims.create({
      key: idleKey,
      frames: scene.anims.generateFrameNumbers(sheetKey, { frames: [0, 1, 0, 0] }),
      frameRate: 4,
      repeat: -1,
    });
  }

  if (!scene.anims.exists(walkKey)) {
    scene.anims.create({
      key: walkKey,
      frames: scene.anims.generateFrameNumbers(sheetKey, { frames: [0, 1, 2, 1] }),
      frameRate: 7,
      repeat: -1,
    });
  }
}

export function createVillageScene(deps: SceneDeps) {
  return class VillageScene extends Phaser.Scene {
    private agentSprites = new Map<AgentId, AgentSpriteBundle>();
    private pickupSprites = new Map<string, PickupBundle>();
    private selectedRing?: Phaser.GameObjects.Rectangle;

    constructor() {
      super("village-scene");
    }

    preload() {
      (Object.keys(spriteAssetPath) as AgentId[]).forEach((agentId) => {
        const key = spriteSheetKey(agentId);
        if (!this.textures.exists(key)) {
          this.load.spritesheet(key, spriteAssetPath[agentId], {
            frameWidth: 16,
            frameHeight: 16,
          });
        }
      });
    }

    create() {
      this.cameras.main.setBackgroundColor("#dff3ff");
      (Object.keys(spriteAssetPath) as AgentId[]).forEach((agentId) => ensureAnimations(this, agentId));

      this.drawWorld();
      this.selectedRing = this.add.rectangle(0, 0, 30, 30).setStrokeStyle(2, 0x4b85ff, 0.9).setVisible(false);
      this.applySnapshot(deps.getSnapshot(), deps.getSelectedAgentId());
    }

    applySnapshot(nextSnapshot: WorldSnapshot, nextSelectedAgentId: AgentId) {
      const seenPickups = new Set<string>();

      nextSnapshot.pickups.forEach((pickup) => {
        seenPickups.add(pickup.id);
        const point = worldToScreen(pickup.position.x, pickup.position.y);
        const color = pickup.kind === "food" ? 0xf5c96f : pickup.kind === "medicine" ? 0xe16b6b : pickup.kind === "goods" ? 0x7da7ff : 0x7f8b96;
        let pickupBundle = this.pickupSprites.get(pickup.id);

        if (!pickupBundle) {
          pickupBundle = {
            dot: this.add.circle(point.x, point.y + 10, 4, color, 0.9),
          };
          this.pickupSprites.set(pickup.id, pickupBundle);
        }

        pickupBundle.dot.setPosition(point.x, point.y + 10).setFillStyle(color, 0.9);
      });

      this.pickupSprites.forEach((bundle, pickupId) => {
        if (seenPickups.has(pickupId)) return;
        bundle.dot.destroy();
        this.pickupSprites.delete(pickupId);
      });

      nextSnapshot.agents.forEach((agent) => {
        let bundle = this.agentSprites.get(agent.id);
        const point = worldToScreen(agent.position.x, agent.position.y);

        if (!bundle) {
          bundle = this.createAgent(agent.id, agent.name);
          this.agentSprites.set(agent.id, bundle);
        }

        const movedDistance = Phaser.Math.Distance.Between(bundle.body.x, bundle.body.y, point.x, point.y);
        const isMoving = movedDistance > 6;
        const facing: Facing = bundle.body.x > point.x ? "left" : "right";

        bundle.facing = facing;
        bundle.body.setFlipX(facing === "left");
        this.setAnimation(bundle, agent.id, isMoving ? "walk" : "idle");

        this.tweens.killTweensOf(bundle.body);
        this.tweens.killTweensOf(bundle.glow);
        this.tweens.killTweensOf(bundle.label);

        this.tweens.add({
          targets: bundle.body,
          x: point.x,
          y: point.y,
          duration: isMoving ? moveTempo[agent.id] * 2.8 : 720,
          ease: agent.id === "hammer" ? "Cubic.Out" : "Sine.Out",
        });
        this.tweens.add({ targets: bundle.glow, x: point.x, y: point.y, duration: 720, ease: "Sine.Out" });
        this.tweens.add({ targets: bundle.label, x: point.x, y: point.y + 24, duration: 720, ease: "Sine.Out" });
        bundle.bobTween?.stop();
        bundle.bobTween = undefined;

        bundle.glow.setFillStyle(moodTint(agent.mood), agent.id === nextSelectedAgentId ? 0.28 : 0.14);
        bundle.label.setText(agent.name.replace("The ", ""));
        bundle.body.setAlpha(agent.alive ? 1 : 0.3);
        bundle.label.setAlpha(agent.alive ? 1 : 0.45);

        const line = recentSpeechForAgent(nextSnapshot, agent.id) ?? recentThoughtForAgent(nextSnapshot, agent.id);
        this.updateBubble(bundle, line, agent.currentAction === "think" || agent.currentAction === "reflect");

        if (agent.id === nextSelectedAgentId && this.selectedRing) {
          this.selectedRing.setVisible(true);
          this.selectedRing.setPosition(point.x, point.y + 2);
        }
      });
    }

    private drawWorld() {
      const g = this.add.graphics();
      g.fillStyle(0xeaf8ff, 1);
      g.fillRoundedRect(14, 14, MAP_WIDTH * TILE + 36, MAP_HEIGHT * TILE + 36, 18);

      for (let y = 0; y < baseMapRows.length; y += 1) {
        for (let x = 0; x < baseMapRows[y].length; x += 1) {
          const cell = baseMapRows[y][x];
          const sx = OFFSET_X + x * TILE;
          const sy = OFFSET_Y + y * TILE;

          if (cell === "^") {
            g.fillStyle(0xa9c3d5, 1);
            g.fillTriangle(sx, sy + TILE, sx + TILE / 2, sy, sx + TILE, sy + TILE);
            g.fillStyle(0x8ea9bc, 1);
            g.fillTriangle(sx + 8, sy + TILE, sx + TILE / 2, sy + 6, sx + TILE - 8, sy + TILE);
          } else if (cell === "t") {
            g.fillStyle(0x6e4b2a, 1);
            g.fillRect(sx + 14, sy + 12, 4, 14);
            g.fillStyle(0x7fb26a, 1);
            g.fillCircle(sx + 16, sy + 10, 10);
            g.fillStyle(0x98c67d, 1);
            g.fillCircle(sx + 11, sy + 12, 7);
            g.fillCircle(sx + 21, sy + 12, 7);
          } else if (cell === "h") {
            g.fillStyle(0xe7c79a, 1);
            g.fillRect(sx + 4, sy + 10, 24, 18);
            g.fillStyle(0xd77848, 1);
            g.fillTriangle(sx + 2, sy + 12, sx + 16, sy + 1, sx + 30, sy + 12);
            g.fillStyle(0x8b5a34, 1);
            g.fillRect(sx + 13, sy + 18, 6, 10);
          } else if (cell === "g") {
            g.fillStyle(0x9ace6a, 1);
            g.fillRect(sx + 4, sy + 4, 24, 24);
            g.fillStyle(0x76a14b, 1);
            g.fillRect(sx + 8, sy + 8, 16, 3);
            g.fillRect(sx + 8, sy + 14, 16, 3);
          } else if (cell === "~") {
            g.fillStyle(0x8ed5f8, 1);
            g.fillRect(sx, sy, TILE, TILE);
            g.lineStyle(2, 0xffffff, 0.35);
            g.strokeLineShape(new Phaser.Geom.Line(sx + 4, sy + 12, sx + 12, sy + 9));
            g.strokeLineShape(new Phaser.Geom.Line(sx + 14, sy + 16, sx + 24, sy + 13));
          } else if (cell === "+") {
            g.fillStyle(0xe0c48f, 1);
            g.fillRect(sx, sy, TILE, TILE);
          } else if (cell === "r") {
            g.fillStyle(0xd9c59d, 1);
            g.fillRect(sx, sy + 8, TILE, 16);
          } else if (cell === "w") {
            g.fillStyle(0xcfe4ef, 1);
            g.fillCircle(sx + 16, sy + 16, 12);
            g.fillStyle(0x82c0e6, 1);
            g.fillCircle(sx + 16, sy + 16, 7);
          } else if (cell === "f") {
            g.fillStyle(0xa56c3f, 1);
            g.fillRect(sx + 10, sy + 18, 12, 4);
            g.fillStyle(0xff8a4b, 1);
            g.fillTriangle(sx + 9, sy + 18, sx + 16, sy + 6, sx + 23, sy + 18);
            g.fillStyle(0xffd38d, 1);
            g.fillTriangle(sx + 12, sy + 17, sx + 16, sy + 10, sx + 20, sy + 17);
          } else if (cell === "o") {
            g.fillStyle(0x9eafbd, 1);
            g.fillCircle(sx + 16, sy + 16, 12);
            g.fillStyle(0x5aa7d4, 1);
            g.fillCircle(sx + 16, sy + 16, 6);
          } else if (cell === "a") {
            g.fillStyle(0xf0d7b4, 1);
            g.fillRect(sx + 4, sy + 9, 24, 18);
            g.fillStyle(0xa6784f, 1);
            g.fillRect(sx + 7, sy + 12, 18, 3);
            g.fillRect(sx + 7, sy + 17, 18, 3);
          } else if (cell === "c") {
            g.fillStyle(0xf6efe7, 1);
            g.fillRect(sx + 5, sy + 8, 22, 18);
            g.fillStyle(0xd86767, 1);
            g.fillRect(sx + 13, sy + 10, 6, 14);
            g.fillRect(sx + 9, sy + 14, 14, 6);
          } else if (cell === "j") {
            g.fillStyle(0xc8d0d8, 1);
            g.fillRect(sx + 4, sy + 8, 24, 20);
            g.fillStyle(0x66727e, 1);
            g.fillRect(sx + 8, sy + 8, 2, 20);
            g.fillRect(sx + 14, sy + 8, 2, 20);
            g.fillRect(sx + 20, sy + 8, 2, 20);
          } else if (cell === "s") {
            g.fillStyle(0xe8d3b1, 1);
            g.fillRect(sx + 6, sy + 11, 20, 16);
            g.fillStyle(0xbc8354, 1);
            g.fillTriangle(sx + 4, sy + 12, sx + 16, sy + 2, sx + 28, sy + 12);
          } else if (cell === "e") {
            g.fillStyle(0xbc8851, 1);
            g.fillRect(sx + 10, sy + 8, 12, 18);
            g.fillStyle(0x7fb26a, 1);
            g.fillCircle(sx + 6, sy + 10, 6);
            g.fillCircle(sx + 26, sy + 10, 6);
          } else {
            g.fillStyle(0xa9d987, 1);
            g.fillRect(sx, sy, TILE, TILE);
            g.fillStyle(0x94c86f, 0.35);
            g.fillCircle(sx + 9, sy + 8, 2);
            g.fillCircle(sx + 22, sy + 21, 1.5);
          }
        }
      }

      g.fillStyle(0xffffff, 0.22);
      g.fillEllipse(OFFSET_X + 8 * TILE, OFFSET_Y + 2.5 * TILE, 210, 50);
      g.fillEllipse(OFFSET_X + 17 * TILE, OFFSET_Y + 1.8 * TILE, 160, 40);
      g.fillEllipse(OFFSET_X + 25 * TILE, OFFSET_Y + 3 * TILE, 200, 46);
    }

    private drawAtmosphere() {}

    private createAgent(id: AgentId, name: string): AgentSpriteBundle {
      const point = worldToScreen(1, 1);
      const glow = this.add.circle(point.x, point.y, 16, moodTint("calm"), 0.14);
      const body = this.add.sprite(point.x, point.y, spriteSheetKey(id), 0).setScale(1.35).setOrigin(0.5, 0.55);

      body.setInteractive({ useHandCursor: true, pixelPerfect: false });
      body.on("pointerdown", () => deps.onSelectAgent(id));

      const label = this.add.text(point.x, point.y + 24, name.replace("The ", ""), {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#4a5e70",
      }).setOrigin(0.5, 0);

      const bundle: AgentSpriteBundle = {
        body,
        glow,
        label,
        bobTween: undefined,
        bubble: undefined,
        bubbleTimer: undefined,
        facing: "right",
        animMode: "idle",
        lastLine: undefined,
      };

      this.setAnimation(bundle, id, "idle");
      return bundle;
    }

    private updateBubble(bundle: AgentSpriteBundle, line: string | null, isThought = false) {
      if (line && line === bundle.lastLine) return;

      bundle.lastLine = line ?? undefined;
      bundle.bubbleTimer?.remove(false);
      bundle.bubble?.destroy();
      bundle.bubble = undefined;

      if (!line) return;

      const width = Math.min(200, Math.max(96, line.length * 6));
      const showBubble = () => {
        const bubble = this.add.container(bundle.body.x + (bundle.facing === "left" ? -6 : 6), bundle.body.y - 38);
        const bg = this.add
          .rectangle(0, 0, width, 30, isThought ? 0xfff6de : 0xffffff, 0.96)
          .setStrokeStyle(1, isThought ? 0xe0bf84 : 0xb9d1e5, 0.9);
        const text = this.add.text(0, 0, line, {
          fontFamily: "monospace",
          fontSize: "9px",
          color: isThought ? "#6a5328" : "#35516b",
          align: "center",
          wordWrap: { width: width - 16 },
        }).setOrigin(0.5);

        bubble.add([bg, text]);
        bundle.bubble = bubble;

        this.tweens.add({ targets: bubble, alpha: { from: 0, to: 1 }, duration: 150 });
        this.tweens.add({ targets: bubble, y: bubble.y - 6, duration: 1800, ease: "Sine.Out" });

        bundle.bubbleTimer = this.time.delayedCall(2400, () => {
          if (!bubble.scene) return;
          this.tweens.add({
            targets: bubble,
            alpha: 0,
            duration: 240,
            onComplete: () => {
              if (bundle.bubble === bubble) bundle.bubble = undefined;
              bubble.destroy();
            },
          });
        });
      };

      this.time.delayedCall(180, showBubble);
    }

    private setAnimation(bundle: AgentSpriteBundle, agentId: AgentId, mode: AnimMode) {
      if (bundle.animMode === mode) return;
      bundle.animMode = mode;
      bundle.body.play(mode === "walk" ? walkAnimKey(agentId) : idleAnimKey(agentId), true);
    }
  };
}
