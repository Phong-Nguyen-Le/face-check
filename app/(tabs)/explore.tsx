import { useCameraPermissions } from "expo-camera";
import { Fragment, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Rect, Svg, Text as SvgText } from "react-native-svg";

import { faceToScreenRect } from "@/components/view/enroll/faceCoords";
import type { FacesDetectedPayload } from "@/modules/expo-face-recognition";
import { ExpoFaceRecognitionView } from "@/modules/expo-face-recognition";

type LogEntry = {
  id: number;
  timestamp: string;
  message: string;
  isError?: boolean;
};

type ScreenBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  name: string;
};

function toScreenBox(
  face: { x: number; y: number; width: number; height: number; name: string },
  viewW: number,
  viewH: number,
): ScreenBox {
  const r = faceToScreenRect(face, { width: viewW, height: viewH });
  return {
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    name: face.name,
  };
}

export default function ExploreScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [faceCount, setFaceCount] = useState<number | null>(null);
  const [faceBoxes, setFaceBoxes] = useState<ScreenBox[]>([]);

  const viewSize = useRef({ width: 0, height: 0 });
  const logIdRef = useRef(0);

  const addLog = (message: string, isError = false) => {
    const now = new Date();
    const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => n.toString().padStart(2, "0"))
      .join(":");
    setLogs((prev) => [
      { id: ++logIdRef.current, timestamp: ts, message, isError },
      ...prev.slice(0, 49),
    ]);
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    viewSize.current = { width, height };
  };

  const handleFacesDetected = ({
    nativeEvent,
  }: {
    nativeEvent: FacesDetectedPayload;
  }) => {
    const { faceCount: count, faces } = nativeEvent;
    const { width: vw, height: vh } = viewSize.current;
    setFaceCount(count);
    setFaceBoxes(
      vw > 0 && vh > 0 ? faces.map((f) => toScreenBox(f, vw, vh)) : [],
    );

    if (count > 0) {
      addLog(`Detected ${count} face${count !== 1 ? "s" : ""}`);
      faces.forEach((face, i) => {
        addLog(
          `  #${i + 1}  x=${face.x.toFixed(0)}  y=${face.y.toFixed(0)}  ${face.width.toFixed(0)}×${face.height.toFixed(0)}`,
        );
      });
    }
  };

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <Text style={styles.message}>Camera access is required</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <ExpoFaceRecognitionView
        style={styles.camera}
        onFacesDetected={handleFacesDetected}
      />

      {/* Face bounding boxes via SVG */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {faceBoxes.map((box, i) => (
          <Fragment key={i}>
            <Rect
              x={box.left}
              y={box.top}
              width={box.width}
              height={box.height}
              stroke="#ff3b30"
              strokeWidth={2}
              fill="none"
              rx={4}
            />
            {box.name ? (
              <SvgText
                x={box.left + box.width / 2}
                y={box.top - 8}
                textAnchor="middle"
                fill="#ff3b30"
                fontSize={13}
                fontWeight="bold"
              >
                {box.name}
              </SvgText>
            ) : null}
          </Fragment>
        ))}
      </Svg>

      {/* Live badge */}
      {faceCount !== null && (
        <View style={styles.badge} pointerEvents="none">
          <View style={styles.badgeInner}>
            <Text style={styles.badgeText}>
              {faceCount > 0
                ? `${faceCount} face${faceCount !== 1 ? "s" : ""}`
                : "No face"}
            </Text>
          </View>
        </View>
      )}

      {/* Log panel */}
      <View style={styles.logPanel}>
        <View style={styles.logHeader}>
          <Text style={styles.logTitle}>Detection Log</Text>
          {logs.length > 0 && (
            <Pressable style={styles.clearBtn} onPress={() => setLogs([])}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
        >
          {logs.length === 0 && (
            <Text style={styles.logEmpty}>Waiting for faces…</Text>
          )}
          {logs.map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <Text style={styles.logTime}>{entry.timestamp}</Text>
              <Text style={[styles.logMsg, entry.isError && styles.logError]}>
                {entry.message}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  badge: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  badgeInner: {
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    color: "#4ade80",
    fontWeight: "700",
    fontSize: 14,
  },
  message: {
    color: "#fff",
    fontSize: 16,
    marginBottom: 20,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  logPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 250,
    backgroundColor: "rgba(0,0,0,0.84)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  logTitle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.4,
  },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#444",
  },
  clearBtnText: { color: "#888", fontSize: 13, fontWeight: "600" },
  logScroll: { flex: 1 },
  logContent: { gap: 3 },
  logEmpty: { color: "#555", fontSize: 13, marginTop: 8 },
  logRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  logTime: {
    color: "#555",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  logMsg: { color: "#d4d4d4", fontSize: 13, flex: 1, fontFamily: "Courier" },
  logError: { color: "#ff6b6b" },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderRadius: 50,
    alignItems: "center",
  },
  btnText: { color: "#000", fontWeight: "600", fontSize: 14 },
});
