import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import type {
  FaceBox,
  FacesDetectedPayload,
} from "@/modules/expo-face-recognition/src/ExpoFaceRecognition.types";
import ExpoFaceRecognitionModule from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import ExpoFaceRecognitionView from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionView";

import { OvalTickProgress } from "@/components/ui/OvalStepProgress";
import { ENROLL_STEPS, HOLD_MS, SLOT_KEYS } from "@/constants/enroll";
import type { FaceStatus, Layout, Slot } from "@/types/enroll";
import { getFaceIssue, OVAL_H, OVAL_W } from "./faceCoords";

type Props = {
  visible: boolean;
  onClose: () => void;
  onCapture: (slot: Slot, uri: string) => void;
};

export default function GuidedEnrollModal({
  visible,
  onClose,
  onCapture,
}: Props) {
  const insets = useSafeAreaInsets();

  const [modalStep, setModalStep] = useState(0);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("none");
  const [holdProgress, setHoldProgress] = useState(0);

  const [completedStep, setCompletedStep] = useState(0);
  const [statusDetail, setStatusDetail] = useState("");
  const [cameraLayout, setCameraLayout] = useState<Layout>({
    width: 0,
    height: 0,
  });
  const [detectedFaces, setDetectedFaces] = useState<FaceBox[]>([]);

  const modalStepRef = useRef(0);
  const isCapturingRef = useRef(false);
  const alignedSinceRef = useRef(0);

  const syncStep = (step: number) => {
    modalStepRef.current = step;
    setModalStep(step);
  };

  const resetState = () => {
    syncStep(0);
    setCompletedStep(0);
    setFaceStatus("none");
    setHoldProgress(0);
    setDetectedFaces([]);
    alignedSinceRef.current = 0;
    isCapturingRef.current = false;
  };

  const handleClose = () => {
    StatusBar.setHidden(false, "slide");
    resetState();
    onClose();
  };

  const captureFrame = async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    alignedSinceRef.current = 0;
    setHoldProgress(0);
    setFaceStatus("none");
    try {
      const uri = await ExpoFaceRecognitionModule.captureFrameAsync();
      const slot = SLOT_KEYS[modalStepRef.current];
      onCapture(slot, uri);
      const next = modalStepRef.current + 1;
      setCompletedStep(next);
      if (next < ENROLL_STEPS.length) {
        syncStep(next);
      } else {
        handleClose();
      }
    } catch {
      // capture failed — allow retry
    } finally {
      isCapturingRef.current = false;
    }
  };

  const handleFaces = ({
    nativeEvent,
  }: {
    nativeEvent: FacesDetectedPayload;
  }) => {
    if (isCapturingRef.current) return;
    const step = ENROLL_STEPS[modalStepRef.current];
    const face = nativeEvent.faces[0];

    setDetectedFaces(nativeEvent.faces);

    if (!face) {
      if (alignedSinceRef.current !== 0) {
        alignedSinceRef.current = 0;
        setFaceStatus("none");
        setHoldProgress(0);
      }
      return;
    }

    const yawOk = face.yaw >= step.yawMin && face.yaw <= step.yawMax;
    const posIssue = getFaceIssue(face, cameraLayout);
    const allOk = !posIssue && yawOk;

    if (!allOk) {
      if (alignedSinceRef.current !== 0) {
        alignedSinceRef.current = 0;
        setHoldProgress(0);
      }
      setStatusDetail(posIssue ?? step.sub);
      setFaceStatus("detecting");
      return;
    }

    setFaceStatus("aligned");
    if (alignedSinceRef.current === 0) alignedSinceRef.current = Date.now();

    const elapsed = Date.now() - alignedSinceRef.current;
    setHoldProgress(Math.min(100, (elapsed / HOLD_MS) * 100));

    if (elapsed >= HOLD_MS) captureFrame();
  };

  const statusMsg =
    faceStatus === "none"
      ? "Đưa khuôn mặt vào khung oval"
      : faceStatus === "detecting"
        ? statusDetail
        : "Giữ nguyên…";

  const currentStep = ENROLL_STEPS[modalStep];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      onShow={() => {
        StatusBar.setHidden(true, "slide");
        resetState();
      }}
    >
      <View style={styles.container}>
        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top - 10 }]}>
          <Pressable style={styles.closeBtn} onPress={handleClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
          <Text style={styles.stepLabel}>
            Bước {modalStep + 1} / {ENROLL_STEPS.length}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Live camera */}
        <ExpoFaceRecognitionView
          style={StyleSheet.absoluteFill}
          onFacesDetected={handleFaces}
          onLayout={(e) => setCameraLayout(e.nativeEvent.layout)}
        />

        {/* Debug: detected face rects */}
        {/* {cameraLayout.width > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {detectedFaces.map((f, i) => {
              const r = faceToScreenRect(f, cameraLayout);
              return (
                <Rect
                  key={i}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  stroke="#ff3b30"
                  strokeWidth={2}
                  fill="none"
                  rx={4}
                />
              );
            })}
          </Svg>
        )} */}

        {/* Dark overlay with oval cutout */}
        {cameraLayout.width > 0 &&
          (() => {
            const W = cameraLayout.width;
            const H = cameraLayout.height;
            const cx = W / 2;
            const cy = H / 2;
            const rx = OVAL_W / 2;
            const ry = OVAL_H / 2;
            const path = [
              `M 0 0 H ${W} V ${H} H 0 Z`,
              `M ${cx - rx} ${cy}`,
              `a ${rx} ${ry} 0 1 0 ${rx * 2} 0`,
              `a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`,
            ].join(" ");
            return (
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                <Path d={path} fill="rgba(0,0,0,0.8)" fillRule="evenodd" />
              </Svg>
            );
          })()}

        <View style={styles.ovalContainer} pointerEvents="none">
          <OvalTickProgress
            width={OVAL_W}
            height={OVAL_H}
            progress={(completedStep + holdProgress / 100) / 3}
            inactiveColor="rgba(255,255,255,0.65)"
            activeColor="#4ade80"
          />
          <View style={styles.ovalCenterText}>
            <Text style={styles.status}>{statusMsg}</Text>
          </View>
          <View style={styles.ovalTextContainer}>
            <Text style={styles.instruction}>{currentStep.label}</Text>
          </View>
        </View>

        {/* Bottom panel */}
        <View style={styles.bottom}>
          <View style={styles.stepDots}>
            {ENROLL_STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.stepDot,
                  i < modalStep && styles.stepDotDone,
                  i === modalStep && styles.stepDotActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.shutterRow}>
            <Pressable style={styles.shutterBtn} onPress={() => captureFrame()}>
              <View style={styles.shutterInner} />
            </Pressable>
          </View>

          <Text style={styles.hint}>Tap button to capture manually</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    zIndex: 10,
    elevation: 10,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  stepLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },

  ovalContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  ovalCenterText: {
    position: "absolute",
    width: OVAL_W,
    height: OVAL_H,
    alignItems: "center",
    justifyContent: "center",
  },
  ovalTextContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 32,
    transform: [{ translateY: OVAL_H / 2 + 24 }],
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: "center",
    gap: 10,
  },
  stepDots: { flexDirection: "row", gap: 8, marginBottom: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#444" },
  stepDotActive: { backgroundColor: "#fff", width: 20, borderRadius: 4 },
  stepDotDone: { backgroundColor: "#4ade80" },

  instruction: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  status: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff",
  },

  hint: { color: "#555", fontSize: 12, textAlign: "center" },
});
