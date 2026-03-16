import { useState, useEffect, useMemo, useRef } from "react";
import { ref, onValue, update, remove } from "firebase/database";

import { db } from "./firebase";
import {
  ESTADOS,
  METODOLOGIAS,
  REQUIERE_METODO,
  REQUIERE_FECHA_COBRO,
  DB_PASSWORD,
  USER_KEY,
  SALDOS_KEY,
  esExcluido,
  fmtARS,
  fmtARSFull,
  fmtFecha,
  parseDate,
  calcDelay,
  toInputDate,
  todayInputDate,
  normalize,
  generarId,
  fmtDateTime,
} from "./constants";
import styles from "./styles";

import AlertaVencimientos from "./AlertaVencimientos";
import TabAnalisis from "./TabAnalisis";
import TabMensajes from "./TabMensajes";
import TabReporting from "./TabReporting";
import TabIntereses from "./TabIntereses";

export default function App() {
  const [registros, setRegistros] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [filtro, setFiltro] = useState("todos");

  const [filtroComisionista, setFiltroComisionista] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [iniciando, setIniciando] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [syncStatus, setSyncStatus] = useState("online");
  const [toast, setToast] = useState(null);
  const [lastUpload, setLastUpload] = useState(null);
  const [activeTab, setActiveTab] = useState("cobranzas");
  const [usuario, setUsuario] = useState(
    () => localStorage.getItem(USER_KEY) || ""
  );
  const [modalNombre, setModalNombre] = useState("");
  const [showModal, setShowModal] = useState(!localStorage.getItem(USER_KEY));
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [bulkEstado, setBulkEstado] = useState("Sin información");
  const [bulkMetodo, setBulkMetodo] = useState("Sin información");
  const [bulkFecha, setBulkFecha] = useState("");
  const [bulkComentario, setBulkComentario] = useState("");
  const [bulkMontoParcial, setBulkMontoParcial] = useState("");

  // ── Cuenta modal ──────────────────────────────────────────────────────────
  // showCuentaModal: controla si mostramos el paso previo de elección de cuenta
  // cuentaCarga: la cuenta elegida ("1" o "2"), se usa en handleFile
  // fileInputRef: referencia al input[type=file] que disparamos programáticamente
  const [showCuentaModal, setShowCuentaModal] = useState(false);
  const [cuentaCarga, setCuentaCarga] = useState(null);
  const fileInputRef = useRef(null);
  // También necesitamos uno para el botón del header ("Agregar archivo")
  const fileInputHeaderRef = useRef(null);
  // Guardamos qué origen disparó el modal ("main" | "header") para saber qué
  // input[type=file] abrir después de elegir la cuenta
  const [cuentaModalOrigen, setCuentaModalOrigen] = useState("main");

  // Abre el modal de selección de cuenta antes de mostrar el file picker
  const abrirModalCuenta = (origen) => {
    setCuentaModalOrigen(origen);
    setCuentaCarga(null);
    setShowCuentaModal(true);
  };

  // Una vez que el usuario elige la cuenta, guardamos y abrimos el file picker
  const elegirCuenta = (num) => {
    setCuentaCarga(num);
    setShowCuentaModal(false);
    // Pequeño timeout para que React aplique el estado antes de hacer click
    setTimeout(() => {
      if (cuentaModalOrigen === "header") {
        fileInputHeaderRef.current?.click();
      } else {
        fileInputRef.current?.click();
      }
    }, 50);
  };
  // ──────────────────────────────────────────────────────────────────────────

  const showToast = (msg, type = "green", duration = 3500) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), duration);
  };

  const getMeta = (id) =>
    metadata[id] || {
      estado: "Sin información",
      metodologia: "Sin información",
      comentario: "",
      montoParcial: "",
      fechaCobro: "",
      ultimoEditor: "",
      ultimaEdicion: "",
    };

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const registrosParaKPIs = useMemo(
    () => registros.filter((r) => !esExcluido(getMeta(r.id).estado)),
    [registros, metadata]
  );

  const isCobrado = (r) => {
    const est = ESTADOS.find((e) => e.label === getMeta(r.id).estado);
    return !!(est && est.esCobrado);
  };
  const isVencido = (r) => {
    const d = parseDate(r.vence);
    return d && d < hoy && !isCobrado(r);
  };
  const isHoy = (r) => {
    const d = parseDate(r.vence);
    if (!d) return false;
    const dc = new Date(d);
    dc.setHours(0, 0, 0, 0);
    return dc.getTime() === hoy.getTime() && !isCobrado(r);
  };

  useEffect(() => {
    const unsubReg = onValue(
      ref(db, "registros"),
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const lista = Object.values(data).sort((a, b) => {
            const da = parseDate(a.vence),
              db2 = parseDate(b.vence);
            if (!da && !db2) return 0;
            if (!da) return 1;
            if (!db2) return -1;
            return da.getTime() - db2.getTime();
          });
          setRegistros(lista);
        } else setRegistros([]);
        setIniciando(false);
      },
      () => {
        setSyncStatus("offline");
        setIniciando(false);
      }
    );

    const unsubMeta = onValue(
      ref(db, "metadata"),
      (snapshot) => {
        setMetadata(snapshot.val() || {});
        setSyncStatus("online");
      },
      () => setSyncStatus("offline")
    );

    onValue(ref(db, "info"), (snapshot) => {
      const data = snapshot.val();
      if (data) setLastUpload(data);
    });

    return () => {
      unsubReg();
      unsubMeta();
    };
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const cuenta = cuentaCarga || "1";
    setCargando(true);
    setError("");

    try {
      // ── Parser nativo para el formato TABLE/BOT ──────────────────────────
      // El software ganadero exporta un formato propietario (no XLS binario
      // real) con esta estructura:
      //   TABLE / VECTORS / TUPLES / DATA
      //   BOT          ← inicio de fila
      //   1,0          ← tipo string
      //   "valor"      ← valor del campo
      //   0,1234,56    ← tipo número (el valor va inline después de "0,")
      //   -1,0         ← fin de fila
      // SheetJS lo lee con errores (filas fantasma, importes mal parseados).
      // Este parser lee el texto directamente y produce filas limpias.
      const buf = await file.arrayBuffer();
      const text = new TextDecoder("latin1").decode(buf);
      const lines = text.split(/\r?\n/);

      const parseTableBOT = (lines) => {
        const rows = [];
        let i = 0;
        while (i < lines.length) {
          if (lines[i].trim() === "BOT") {
            i++;
            const row = [];
            while (i < lines.length) {
              const l = lines[i].trim();
              if (l === "-1,0") {
                i++;
                break;
              }
              if (l === "1,0") {
                i++;
                if (i < lines.length) {
                  row.push(lines[i].trim().replace(/^"|"$/g, "").trim());
                  i++;
                }
              } else if (l.startsWith("0,")) {
                // El importe viene como "0,52.249.925,00" — tomamos todo
                // después de "0," como string con formato argentino
                row.push(l.slice(2).trim());
                i++;
                // Saltar línea "V" que sigue al número
                if (i < lines.length && lines[i].trim() === "V") i++;
              } else {
                i++;
              }
            }
            rows.push(row);
          } else {
            i++;
          }
        }
        return rows;
      };

      // Parsear importe formato argentino: "52.249.925,00" → 52249925
      const parseImporte = (v) => {
        if (!v || v === "") return NaN;
        const limpio = String(v).trim().replace(/\./g, "").replace(",", ".");
        return parseFloat(limpio);
      };

      const allRows = parseTableBOT(lines);
      if (allRows.length < 2) {
        setError("No se pudieron leer filas del archivo.");
        setCargando(false);
        return;
      }

      // Primera fila = headers
      // Columnas esperadas: Fecha / Comprobante / Numero / Descripcion /
      //                     Cuenta Corriente / Vence / Importe / Comisionista
      const headers = allRows[0].map((h) => normalize(h));
      const col = (name) => headers.findIndex((h) => h.includes(name));
      const iComp = col("comprobante");
      const iNum = col("numero");
      const iDesc = col("descripcion");
      const iCuenta = col("cuenta");
      const iVence = col("vence");
      const iImp = col("importe");
      const iComis = col("comisionista");

      if (iNum === -1 || iImp === -1 || iVence === -1) {
        setError("No se encontraron las columnas esperadas.");
        setCargando(false);
        return;
      }

      const nuevos = [];
      // IDs vistos dentro de este archivo — para detectar duplicados internos
      const idsEnArchivo = new Map(); // id → numero de comprobante
      const duplicadosArchivo = []; // { numero, cliente } de filas duplicadas

      for (let i = 1; i < allRows.length; i++) {
        const r = allRows[i];
        if (!r || r.length < 3) continue;

        const num = String(r[iNum] || "").trim();
        const venceRaw = String(r[iVence] || "").trim();
        const impStr = String(r[iImp] || "").trim();
        const comp = String(r[iComp] || "").trim();
        const desc = String(r[iDesc] || "").trim();
        const cuentaR = String(r[iCuenta] || "").trim();
        const comis = String(r[iComis] || "").trim();

        // Descartar filas sin número de liquidación
        if (!num || num === "0") continue;

        // Descartar subtotales diarios (fecha >= 2050)
        const fechaD = parseDate(venceRaw);
        if (!fechaD || fechaD.getFullYear() >= 2050) continue;

        // Parsear importe y descartar negativos/cero
        const importe = parseImporte(impStr);
        if (isNaN(importe) || importe <= 0) continue;

        // Descartar filas cuya celda ENTERA sea "total"
        const descNorm = normalize(desc).replace(/\s+/g, "");
        const cuentaNorm = normalize(cuentaR).replace(/\s+/g, "");
        const compNorm = normalize(comp).replace(/\s+/g, "");
        if (
          descNorm === "total" ||
          cuentaNorm === "total" ||
          compNorm === "total"
        )
          continue;

        const idBase = generarId(num, venceRaw, importe);
        const id = `C${cuenta}_${idBase}`;

        // Detectar duplicado dentro del mismo archivo
        if (idsEnArchivo.has(id)) {
          duplicadosArchivo.push({ numero: num, cliente: cuentaR });
          continue; // descartamos la segunda aparición
        }
        idsEnArchivo.set(id, num);

        nuevos.push({
          id,
          comprobante: comp,
          numero: num,
          descripcion: desc,
          cuenta: cuentaR,
          vence: fmtFecha(fechaD),
          importe,
          comisionista: comis,
          cuentaNum: cuenta,
        });
      }

      // Avisar si hubo duplicados en el archivo fuente
      if (duplicadosArchivo.length > 0) {
        const lista = duplicadosArchivo
          .map((d) => `${d.numero} (${d.cliente})`)
          .join(", ");
        showToast(
          `⚠️ ${duplicadosArchivo.length} comprobante${
            duplicadosArchivo.length > 1 ? "s" : ""
          } duplicado${
            duplicadosArchivo.length > 1 ? "s" : ""
          } en el archivo — se cargó solo uno: ${lista}`,
          "red",
          8000
        );
      }

      const idsExistentes = new Set(registros.map((r) => r.id));
      const soloNuevos = nuevos.filter((r) => !idsExistentes.has(r.id));

      if (soloNuevos.length === 0) {
        showToast(
          "No hay comprobantes nuevos — todo ya estaba cargado",
          "blue"
        );
        setCargando(false);
        e.target.value = "";
        return;
      }

      setSyncStatus("syncing");
      const updates = {};
      soloNuevos.forEach((r) => {
        updates[`registros/${r.id}`] = r;
      });
      updates["info"] = {
        ultimaCarga: fmtDateTime(),
        archivo: file.name,
        nuevos: soloNuevos.length,
        total: nuevos.length,
      };
      await update(ref(db), updates);
      setSyncStatus("online");
      showToast(
        `${
          soloNuevos.length
        } comprobantes nuevos de Cuenta ${cuenta} agregados (${
          nuevos.length - soloNuevos.length
        } ya existían)`,
        "green"
      );
    } catch (err) {
      setError("Error al leer el archivo: " + err.message);
    }
    setCargando(false);
    e.target.value = "";
  };

  const updateMeta = async (id, field, value) => {
    setSyncStatus("syncing");
    const updatedFields = {
      [field]: value,
      ultimoEditor: usuario,
      ultimaEdicion: fmtDateTime(),
    };
    setMetadata((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...updatedFields },
    }));
    try {
      await update(ref(db, `metadata/${id}`), updatedFields);
      setSyncStatus("online");
    } catch {
      setSyncStatus("offline");
    }
  };

  const confirmarUsuario = () => {
    const nombre = modalNombre.trim();
    if (!nombre) return;
    localStorage.setItem(USER_KEY, nombre);
    setUsuario(nombre);
    setShowModal(false);
  };

  const handleDeleteDB = async () => {
    if (deletePassword !== DB_PASSWORD) {
      setDeleteError(true);
      return;
    }
    setDeleting(true);
    try {
      await remove(ref(db, "registros"));
      await remove(ref(db, "metadata"));
      await remove(ref(db, "info"));
      setRegistros([]);
      setMetadata({});
      setLastUpload(null);
      setShowDeleteModal(false);
      setDeletePassword("");
      setDeleteError(false);
      showToast("Base de datos borrada correctamente", "green");
    } catch (e) {
      showToast("Error al borrar: " + e.message, "red");
    }
    setDeleting(false);
  };

  const toggleModoSeleccion = () => {
    setModoSeleccion((prev) => !prev);
    setSeleccionados(new Set());
    setSelectedId(null);
    setBulkEstado("Sin información");
    setBulkMetodo("Sin información");
    setBulkFecha("");
    setBulkComentario("");
    setBulkMontoParcial("");
  };

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const aplicarEnBloque = async () => {
    if (seleccionados.size === 0) return;
    if (bulkEstado === "Pago parcial" && !bulkMontoParcial) return;
    setSyncStatus("syncing");
    const ts = fmtDateTime();
    const updates = {};
    seleccionados.forEach((id) => {
      const campos = {
        ...(metadata[id] || {}),
        ultimoEditor: usuario,
        ultimaEdicion: ts,
      };
      if (bulkEstado !== "Sin información") campos.estado = bulkEstado;
      if (bulkEstado === "Pago parcial" && bulkMontoParcial)
        campos.montoParcial = bulkMontoParcial;
      if (bulkMetodo !== "Sin información") campos.metodologia = bulkMetodo;
      if (bulkFecha) campos.fechaCobro = bulkFecha;
      if (bulkComentario.trim()) campos.comentario = bulkComentario.trim();
      updates[`metadata/${id}`] = campos;
    });
    setMetadata((prev) => {
      const next = { ...prev };
      Object.entries(updates).forEach(([path, val]) => {
        next[path.replace("metadata/", "")] = val;
      });
      return next;
    });
    try {
      await update(ref(db), updates);
      setSyncStatus("online");
      showToast(`${seleccionados.size} comprobantes actualizados`, "green");
      toggleModoSeleccion();
    } catch (e) {
      setSyncStatus("offline");
      showToast("Error al guardar: " + e.message, "red");
    }
  };

  const opcionesComisionista = useMemo(() => {
    const set = new Set(
      registros.map((r) => r.comisionista).filter((c) => c && c.trim() !== "")
    );
    return [...set].sort();
  }, [registros]);

  const hayPropios = useMemo(
    () =>
      registros.some((r) => !r.comisionista || r.comisionista.trim() === ""),
    [registros]
  );

  const registrosFiltrados = useMemo(() => {
    let lista = registros;
    if (filtro === "pendientes") lista = lista.filter((r) => !isCobrado(r));
    else if (filtro === "cobrados") lista = lista.filter((r) => isCobrado(r));
    else if (filtro === "vencidos") lista = lista.filter((r) => isVencido(r));

    if (filtroComisionista === "__propios__")
      lista = lista.filter(
        (r) => !r.comisionista || r.comisionista.trim() === ""
      );
    else if (filtroComisionista)
      lista = lista.filter((r) => r.comisionista === filtroComisionista);
    if (busqueda.trim()) {
      const b = normalize(busqueda);
      lista = lista.filter(
        (r) =>
          normalize(r.cuenta).includes(b) ||
          normalize(r.descripcion).includes(b) ||
          normalize(r.comprobante).includes(b) ||
          normalize(r.comisionista).includes(b)
      );
    }
    return lista;
  }, [registros, metadata, filtro, filtroComisionista, busqueda]);

  const totalPendiente = registrosParaKPIs
    .filter((r) => !isCobrado(r))
    .reduce((s, r) => s + r.importe, 0);
  const totalCobrado = registrosParaKPIs
    .filter((r) => isCobrado(r))
    .reduce((s, r) => s + r.importe, 0);
  const totalVencido = registrosParaKPIs
    .filter((r) => isVencido(r))
    .reduce((s, r) => s + r.importe, 0);
  const totalParcial = registrosParaKPIs
    .filter((r) => getMeta(r.id).estado === "Pago parcial")
    .reduce((s, r) => s + r.importe, 0);

  const selectedReg = !modoSeleccion
    ? registros.find((r) => r.id === selectedId)
    : null;
  const selectedMeta = selectedReg ? getMeta(selectedId) : null;
  const selectedEstadoObj = selectedMeta
    ? ESTADOS.find((e) => e.label === selectedMeta.estado)
    : null;
  const montoParcialNum = selectedMeta ? Number(selectedMeta.montoParcial) : 0;
  const requiereMetodo =
    selectedMeta && REQUIERE_METODO.includes(selectedMeta.estado);
  const metodoFaltante =
    requiereMetodo &&
    (!selectedMeta.metodologia ||
      selectedMeta.metodologia === "Sin información");
  const fechaFaltante =
    selectedMeta &&
    REQUIERE_FECHA_COBRO.includes(selectedMeta.estado) &&
    !selectedMeta.fechaCobro;
  const campoFaltante = metodoFaltante || fechaFaltante;
  const delayCobro =
    selectedReg && selectedMeta?.fechaCobro
      ? calcDelay(selectedReg.vence, selectedMeta.fechaCobro)
      : null;
  const bulkApplyDisabled =
    seleccionados.size === 0 ||
    (bulkEstado === "Pago parcial" && !bulkMontoParcial);

  const handleRowClick = (id) => {
    if (modoSeleccion) {
      toggleSeleccion(id);
      return;
    }
    if (campoFaltante) {
      showToast("Completá los campos obligatorios antes de continuar", "red");
      return;
    }
    setSelectedId(selectedId === id ? null : id);
  };

  const irARegistro = (id) => {
    if (campoFaltante) {
      showToast("Completá los campos obligatorios antes de continuar", "red");
      return;
    }
    setActiveTab("cobranzas");
    setFiltro("todos");
    setFiltroComisionista("");
    setBusqueda("");
    setSelectedId(id);
    setTimeout(() => {
      const el = document.querySelector(`tr[data-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  if (iniciando)
    return (
      <div
        style={{
          fontFamily: "Montserrat, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#F0F2F5",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            background: "#1877F2",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>
            G
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>
          Cargando datos...
        </div>
      </div>
    );

  return (
    <>
      <style>{styles}</style>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {selectedId && !modoSeleccion && (
        <div
          className="panel-backdrop"
          onClick={() => {
            if (!campoFaltante) setSelectedId(null);
          }}
        />
      )}

      {/* ── Modal: ¿Quién sos? ────────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-logo">
              <span>G</span>
            </div>
            <div className="modal-title">¿Quién sos?</div>
            <div className="modal-sub">
              Escribí tu nombre para identificar tus cambios en el sistema.
            </div>
            <input
              className="modal-input"
              placeholder="Tu nombre..."
              value={modalNombre}
              onChange={(e) => setModalNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmarUsuario()}
              autoFocus
            />
            <button
              className="modal-btn"
              onClick={confirmarUsuario}
              disabled={!modalNombre.trim()}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Borrar DB ─────────────────────────────────────────────── */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-logo danger">
              <span style={{ fontSize: 22 }}>!</span>
            </div>
            <div className="modal-title">Borrar base de datos</div>
            <div className="modal-sub">
              Esta acción eliminará{" "}
              <strong>todos los registros y estados</strong>. No se puede
              deshacer.
              <br />
              <br />
              Ingresá la contraseña para confirmar.
            </div>
            <input
              className={`modal-input${deleteError ? " error" : ""}`}
              type="password"
              placeholder="Contraseña..."
              value={deletePassword}
              onChange={(e) => {
                setDeletePassword(e.target.value);
                setDeleteError(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleDeleteDB()}
              autoFocus
            />
            {deleteError && (
              <div className="modal-error-msg">Contraseña incorrecta</div>
            )}
            <button
              className="modal-btn danger"
              onClick={handleDeleteDB}
              disabled={deleting || !deletePassword}
            >
              {deleting ? "Borrando..." : "Borrar todo"}
            </button>
            <button
              className="modal-btn-cancel"
              onClick={() => {
                setShowDeleteModal(false);
                setDeletePassword("");
                setDeleteError(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Elegir cuenta antes de cargar archivo ─────────────────── */}
      {showCuentaModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-logo" style={{ background: "#1877F2" }}>
              <span>📂</span>
            </div>
            <div className="modal-title">¿De qué cuenta es el archivo?</div>
            <div className="modal-sub">
              Elegí la cuenta para que los comprobantes queden correctamente
              identificados en el sistema.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 8,
                marginBottom: 4,
              }}
            >
              {/* Cuenta 1 — azul */}
              <button
                onClick={() => elegirCuenta("1")}
                style={{
                  flex: 1,
                  padding: "18px 0",
                  borderRadius: 12,
                  border: "2px solid #1877F2",
                  background: "#EBF3FF",
                  color: "#1877F2",
                  fontFamily: "Montserrat, sans-serif",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    background: "#1877F2",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "2px 10px",
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: 0.5,
                  }}
                >
                  C1
                </span>
                Cuenta 1
              </button>
              {/* Cuenta 2 — violeta */}
              <button
                onClick={() => elegirCuenta("2")}
                style={{
                  flex: 1,
                  padding: "18px 0",
                  borderRadius: 12,
                  border: "2px solid #6366F1",
                  background: "#F0F0FF",
                  color: "#6366F1",
                  fontFamily: "Montserrat, sans-serif",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    background: "#6366F1",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "2px 10px",
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: 0.5,
                  }}
                >
                  C2
                </span>
                Cuenta 2
              </button>
            </div>
            <button
              className="modal-btn-cancel"
              onClick={() => setShowCuentaModal(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* inputs[type=file] ocultos — uno para el área vacía, otro para el header */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <input
        ref={fileInputHeaderRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFile}
        style={{ display: "none" }}
      />

      <div className="app">
        <div className="header">
          <div className="header-left">
            <div className="header-logo">
              <span>G</span>
            </div>
            <div>
              <div className="header-title">Seguimiento de Cobranzas</div>
              <div className="header-sub">
                Consignataria Galarraga
                {lastUpload
                  ? ` — Última carga: ${lastUpload.ultimaCarga} (${lastUpload.archivo})`
                  : ""}
              </div>
            </div>
          </div>
          <div className="header-right">
            {usuario && (
              <div className="user-chip">
                <div className="user-dot" />
                <span className="user-name">{usuario}</span>
                <span
                  className="user-change"
                  onClick={() => {
                    setModalNombre(usuario);
                    setShowModal(true);
                  }}
                >
                  cambiar
                </span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className={`sync-dot ${syncStatus}`}></span>
              <span className="sync-label">
                {syncStatus === "online"
                  ? "Sincronizado"
                  : syncStatus === "syncing"
                  ? "Guardando..."
                  : "Sin conexión"}
              </span>
            </div>
            {/* El botón del header ahora pasa por el modal de cuenta también */}
            <button
              className="btn-change"
              onClick={() => abrirModalCuenta("header")}
            >
              {registros.length > 0 ? "Agregar archivo" : "Cargar archivo"}
            </button>
            <button
              className="btn-danger"
              onClick={() => setShowDeleteModal(true)}
            >
              Borrar DB
            </button>
          </div>
        </div>

        {registros.length === 0 ? (
          <div className="upload-area">
            <div style={{ fontSize: 36, marginBottom: 16 }}>📂</div>
            <div className="upload-title">Cargar liquidaciones</div>
            <div className="upload-desc">
              Archivo Excel con comprobantes (.xlsx o .xls)
            </div>
            {/* El botón del área vacía también pasa por el modal */}
            <button
              className="btn-upload"
              onClick={() => abrirModalCuenta("main")}
            >
              Seleccionar archivo
            </button>
            {cargando && (
              <p style={{ color: "#1877F2", marginTop: 14, fontSize: 12 }}>
                Procesando...
              </p>
            )}
            {error && (
              <p style={{ color: "#E8335A", marginTop: 14, fontSize: 12 }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="tabs">
              <button
                className={`tab-btn${
                  activeTab === "cobranzas" ? " active" : ""
                }`}
                onClick={() => setActiveTab("cobranzas")}
              >
                Cobranzas
              </button>
              <button
                className={`tab-btn${
                  activeTab === "analisis" ? " active" : ""
                }`}
                onClick={() => setActiveTab("analisis")}
              >
                Análisis
              </button>
              <button
                className={`tab-btn${
                  activeTab === "reporting" ? " active" : ""
                }`}
                onClick={() => setActiveTab("reporting")}
              >
                Reporting
              </button>
              <button
                className={`tab-btn${
                  activeTab === "mensajes" ? " active" : ""
                }`}
                onClick={() => setActiveTab("mensajes")}
              >
                Mensajes
              </button>
              <button
                className={`tab-btn${
                  activeTab === "intereses" ? " active" : ""
                }`}
                onClick={() => setActiveTab("intereses")}
              >
                Intereses
              </button>
            </div>

            {activeTab === "analisis" ? (
              <TabAnalisis registros={registros} metadata={metadata} />
            ) : activeTab === "reporting" ? (
              <TabReporting registros={registros} metadata={metadata} />
            ) : activeTab === "mensajes" ? (
              <TabMensajes registros={registros} metadata={metadata} />
            ) : activeTab === "intereses" ? (
              <TabIntereses />
            ) : (
              <>
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    background: "#F0F2F5",
                    paddingBottom: 8,
                  }}
                >
                  <div className="stats-grid">
                    <div className="stat-card pending">
                      <div className="stat-label">Para cobrar</div>
                      <div className="stat-value">{fmtARS(totalPendiente)}</div>
                      <div className="stat-sub">
                        {registrosParaKPIs.filter((r) => !isCobrado(r)).length}{" "}
                        comprobantes
                      </div>
                    </div>
                    <div className="stat-card overdue">
                      <div className="stat-label">Vencido sin cobrar</div>
                      <div className="stat-value">{fmtARS(totalVencido)}</div>
                      <div className="stat-sub">
                        {registrosParaKPIs.filter((r) => isVencido(r)).length}{" "}
                        comprobantes
                      </div>
                    </div>
                    <div className="stat-card paid">
                      <div className="stat-label">Cobrado</div>
                      <div className="stat-value">{fmtARS(totalCobrado)}</div>
                      <div className="stat-sub">
                        {registrosParaKPIs.filter((r) => isCobrado(r)).length}{" "}
                        comprobantes
                      </div>
                    </div>
                    <div className="stat-card partial">
                      <div className="stat-label">Pago parcial</div>
                      <div className="stat-value">{fmtARS(totalParcial)}</div>
                      <div className="stat-sub">
                        {
                          registrosParaKPIs.filter(
                            (r) => getMeta(r.id).estado === "Pago parcial"
                          ).length
                        }{" "}
                        comprobantes
                      </div>
                    </div>
                  </div>

                  <AlertaVencimientos
                    registros={registros}
                    metadata={metadata}
                    onClickRegistro={irARegistro}
                  />

                  <div className="toolbar">
                    {/* Filtros de estado — sin cambios */}
                    <div className="filter-group">
                      {[
                        { k: "todos", label: "Todos" },
                        { k: "pendientes", label: "Pendientes" },
                        { k: "vencidos", label: "Vencidos" },
                        { k: "cobrados", label: "Cobrados" },
                      ].map((f) => (
                        <button
                          key={f.k}
                          className={`filter-btn${
                            filtro === f.k ? " active" : ""
                          }`}
                          onClick={() => {
                            if (campoFaltante) {
                              showToast(
                                "Completá los campos obligatorios antes de continuar",
                                "red"
                              );
                              return;
                            }
                            setFiltro(f.k);
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {(opcionesComisionista.length > 0 || hayPropios) && (
                      <select
                        className={`comis-select${
                          filtroComisionista ? " active" : ""
                        }`}
                        value={filtroComisionista}
                        onChange={(e) => {
                          if (campoFaltante) {
                            showToast(
                              "Completá los campos obligatorios antes de continuar",
                              "red"
                            );
                            return;
                          }
                          setFiltroComisionista(e.target.value);
                        }}
                      >
                        <option value="">Todos los comisionistas</option>
                        {hayPropios && (
                          <option value="__propios__">Propios</option>
                        )}
                        {opcionesComisionista.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}

                    <input
                      type="text"
                      className="search-input"
                      placeholder="Buscar por cliente, comprobante, comisionista..."
                      value={busqueda}
                      onChange={(e) => {
                        if (campoFaltante) {
                          showToast(
                            "Completá los campos obligatorios antes de continuar",
                            "red"
                          );
                          return;
                        }
                        setBusqueda(e.target.value);
                      }}
                    />
                    <button
                      className={`filter-btn${
                        modoSeleccion ? " selection-mode" : ""
                      }`}
                      onClick={toggleModoSeleccion}
                    >
                      {modoSeleccion
                        ? "Cancelar selección"
                        : "Selección múltiple"}
                    </button>
                  </div>

                  {modoSeleccion && (
                    <div className="bulk-panel">
                      <div
                        style={{
                          width: "100%",
                          marginBottom: 8,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <span className="bulk-panel-title">
                          Editar en bloque
                        </span>
                        {seleccionados.size > 0 ? (
                          <span className="bulk-count">
                            {seleccionados.size} seleccionados
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 12,
                              color: "#666",
                              marginLeft: 12,
                            }}
                          >
                            Seleccioná comprobantes en la tabla
                          </span>
                        )}
                      </div>
                      <div className="bulk-field">
                        <div className="bulk-label">Estado</div>
                        <select
                          className="bulk-select"
                          value={bulkEstado}
                          onChange={(e) => {
                            setBulkEstado(e.target.value);
                            if (e.target.value !== "Pago parcial")
                              setBulkMontoParcial("");
                          }}
                        >
                          <option value="Sin información">
                            — No cambiar —
                          </option>
                          {ESTADOS.filter(
                            (e) => e.label !== "Sin información"
                          ).map((est) => (
                            <option key={est.label} value={est.label}>
                              {est.label}
                            </option>
                          ))}
                        </select>
                        {bulkEstado === "Pago parcial" && (
                          <div style={{ marginTop: 8 }}>
                            <div
                              className="bulk-label"
                              style={{ color: "#E8970C" }}
                            >
                              Monto cobrado{" "}
                              <span style={{ color: "#E8335A" }}>*</span>
                            </div>
                            <input
                              type="number"
                              className={`bulk-input${
                                bulkMontoParcial
                                  ? " required-ok"
                                  : " required-empty"
                              }`}
                              placeholder="Monto..."
                              value={bulkMontoParcial}
                              onChange={(e) =>
                                setBulkMontoParcial(e.target.value)
                              }
                            />
                            {!bulkMontoParcial && (
                              <div className="bulk-required-msg">
                                Campo obligatorio para Pago parcial
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bulk-field">
                        <div className="bulk-label">Metodología</div>
                        <select
                          className="bulk-select"
                          value={bulkMetodo}
                          onChange={(e) => setBulkMetodo(e.target.value)}
                        >
                          <option value="Sin información">
                            — No cambiar —
                          </option>
                          {METODOLOGIAS.filter(
                            (m) => m !== "Sin información"
                          ).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bulk-field">
                        <div className="bulk-label">Fecha de cobro</div>
                        <input
                          type="date"
                          className="bulk-input"
                          value={bulkFecha}
                          onChange={(e) => setBulkFecha(e.target.value)}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "#aaa",
                            cursor: "pointer",
                            textDecoration: "underline",
                            display: "block",
                            marginTop: 4,
                          }}
                          onClick={() => setBulkFecha(todayInputDate())}
                        >
                          Usar hoy
                        </span>
                      </div>
                      <div className="bulk-field">
                        <div className="bulk-label">Comentario</div>
                        <textarea
                          className="bulk-textarea"
                          placeholder="Comentario para todos..."
                          value={bulkComentario}
                          onChange={(e) => setBulkComentario(e.target.value)}
                        />
                      </div>
                      <div className="bulk-actions">
                        <button
                          className="bulk-apply"
                          onClick={aplicarEnBloque}
                          disabled={bulkApplyDisabled}
                        >
                          Aplicar a {seleccionados.size} comprobante
                          {seleccionados.size !== 1 ? "s" : ""}
                        </button>
                        <button
                          className="bulk-cancel"
                          onClick={toggleModoSeleccion}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="main-layout">
                  <div className="main-content">
                    {campoFaltante && !modoSeleccion && (
                      <div className="table-overlay">
                        <div className="table-overlay-msg">
                          <div className="table-overlay-icon">🔒</div>
                          <div className="table-overlay-title">
                            Campo obligatorio pendiente
                          </div>
                          <div className="table-overlay-sub">
                            {metodoFaltante &&
                              "Seleccioná la metodología de cobro en el panel derecho"}
                            {metodoFaltante && fechaFaltante && <br />}
                            {fechaFaltante &&
                              "Ingresá la fecha de cobro en el panel derecho"}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="table-wrapper">
                      <div className="table-meta">
                        <span>
                          {registrosFiltrados.length} de {registros.length}{" "}
                          comprobantes
                          {filtroComisionista && (
                            <span
                              style={{
                                marginLeft: 8,
                                background: "#EBF3FF",
                                color: "#1877F2",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 10px",
                                borderRadius: 20,
                              }}
                            >
                              {filtroComisionista === "__propios__"
                                ? "Propios"
                                : filtroComisionista}
                            </span>
                          )}
                          {modoSeleccion && seleccionados.size > 0 && (
                            <span className="bulk-count">
                              {seleccionados.size} seleccionados
                            </span>
                          )}
                        </span>
                        {cargando && (
                          <span style={{ color: "#1877F2", fontWeight: 600 }}>
                            Procesando archivo...
                          </span>
                        )}
                        {error && (
                          <span style={{ color: "#E8335A" }}>{error}</span>
                        )}
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              {modoSeleccion && <th className="col-check"></th>}
                              <th className="col-vence">Vence</th>
                              <th className="col-cliente">
                                Cliente / Descripción
                              </th>
                              <th className="col-comp">N° Liq.</th>
                              <th className="col-estado">Estado</th>
                              <th className="col-metodo">Metodología</th>
                              <th className="col-importe right">Importe</th>
                              <th className="col-editor">Último editor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {registrosFiltrados.map((r) => {
                              const vencido = isVencido(r),
                                hoyVence = isHoy(r),
                                cobrado = isCobrado(r);
                              const meta = getMeta(r.id);
                              const estadoObj = ESTADOS.find(
                                (e) => e.label === meta.estado
                              );
                              const esExcluidoR = esExcluido(meta.estado);
                              const isSelected =
                                !modoSeleccion && selectedId === r.id;
                              const isChecked =
                                modoSeleccion && seleccionados.has(r.id);
                              return (
                                <tr
                                  key={r.id}
                                  data-id={r.id}
                                  className={
                                    isSelected
                                      ? "row-selected"
                                      : isChecked
                                      ? "row-checked"
                                      : cobrado && !esExcluidoR
                                      ? "row-paid"
                                      : vencido
                                      ? "row-overdue"
                                      : hoyVence
                                      ? "row-today"
                                      : ""
                                  }
                                  onClick={() => handleRowClick(r.id)}
                                >
                                  {modoSeleccion && (
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        className="cb"
                                        checked={isChecked}
                                        onChange={() => toggleSeleccion(r.id)}
                                      />
                                    </td>
                                  )}
                                  <td className="nowrap">
                                    <span
                                      className={
                                        cobrado && !esExcluidoR
                                          ? "date-paid"
                                          : vencido
                                          ? "date-overdue"
                                          : hoyVence
                                          ? "date-today"
                                          : "date-normal"
                                      }
                                    >
                                      {r.vence}
                                    </span>
                                    {vencido && (
                                      <span className="badge-vencido">
                                        Vencido
                                      </span>
                                    )}
                                    {hoyVence && (
                                      <span className="badge-hoy">Hoy</span>
                                    )}
                                  </td>
                                  <td className="col-cliente">
                                    <div
                                      className={`client-name${
                                        cobrado && !esExcluidoR ? " paid" : ""
                                      }`}
                                    >
                                      {r.cuenta || r.descripcion || "-"}
                                      {/* Badge de cuenta — chico, al lado del nombre */}
                                      {r.cuentaNum && (
                                        <span
                                          style={{
                                            marginLeft: 6,
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: "1px 6px",
                                            borderRadius: 4,
                                            verticalAlign: "middle",
                                            background:
                                              r.cuentaNum === "1"
                                                ? "#EBF3FF"
                                                : "#F0F0FF",
                                            color:
                                              r.cuentaNum === "1"
                                                ? "#1877F2"
                                                : "#6366F1",
                                            border: `1px solid ${
                                              r.cuentaNum === "1"
                                                ? "#bcd4f8"
                                                : "#c4c5f5"
                                            }`,
                                          }}
                                        >
                                          C{r.cuentaNum}
                                        </span>
                                      )}
                                    </div>
                                    {r.cuenta && r.descripcion && (
                                      <div className="client-sub">
                                        {r.descripcion}
                                      </div>
                                    )}
                                  </td>
                                  <td className="nowrap">
                                    <span className="comp-text">
                                      {r.numero}
                                    </span>
                                  </td>
                                  <td className="nowrap">
                                    {estadoObj &&
                                    meta.estado !== "Sin información" ? (
                                      <>
                                        <span
                                          className="estado-badge"
                                          style={{
                                            background: estadoObj.bg,
                                            color: estadoObj.color,
                                          }}
                                        >
                                          {meta.estado}
                                        </span>
                                        {esExcluidoR && (
                                          <span className="excluido-badge">
                                            No incluido en cálculos
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <span
                                        style={{ color: "#ddd", fontSize: 11 }}
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className="nowrap">
                                    {meta.metodologia &&
                                    meta.metodologia !== "Sin información" ? (
                                      <span className="metodo-badge">
                                        {meta.metodologia}
                                      </span>
                                    ) : (
                                      <span
                                        style={{ color: "#ddd", fontSize: 11 }}
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className="right">
                                    <span
                                      className={
                                        cobrado && !esExcluidoR
                                          ? "amount-paid"
                                          : "amount-text"
                                      }
                                    >
                                      {fmtARSFull(r.importe)}
                                    </span>
                                  </td>
                                  <td className="nowrap">
                                    {meta.ultimoEditor ? (
                                      <>
                                        <div className="editor-name">
                                          {meta.ultimoEditor}
                                        </div>
                                        <div className="editor-time">
                                          {meta.ultimaEdicion}
                                        </div>
                                      </>
                                    ) : (
                                      <span
                                        style={{ color: "#ddd", fontSize: 11 }}
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {registrosFiltrados.length === 0 && (
                              <tr>
                                <td
                                  colSpan={modoSeleccion ? 8 : 7}
                                  className="empty-cell"
                                >
                                  No hay comprobantes para mostrar
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                {!modoSeleccion && selectedReg && (
                  <div className="side-panel">
                    <div className="panel-header">
                      <div className="panel-title">Detalle</div>
                      <button
                        className={`panel-close${
                          campoFaltante ? " blocked" : ""
                        }`}
                        onClick={() => {
                          if (campoFaltante) {
                            showToast(
                              "Completá los campos obligatorios antes de continuar",
                              "red"
                            );
                            return;
                          }
                          setSelectedId(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="panel-body">
                      <div className="panel-client">
                        {selectedReg.cuenta || selectedReg.descripcion || "-"}
                        {/* Badge de cuenta también en el panel lateral */}
                        {selectedReg.cuentaNum && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: 6,
                              verticalAlign: "middle",
                              background:
                                selectedReg.cuentaNum === "1"
                                  ? "#EBF3FF"
                                  : "#F0F0FF",
                              color:
                                selectedReg.cuentaNum === "1"
                                  ? "#1877F2"
                                  : "#6366F1",
                              border: `1px solid ${
                                selectedReg.cuentaNum === "1"
                                  ? "#bcd4f8"
                                  : "#c4c5f5"
                              }`,
                            }}
                          >
                            Cuenta {selectedReg.cuentaNum}
                          </span>
                        )}
                      </div>
                      {selectedReg.cuenta && selectedReg.descripcion && (
                        <div className="panel-meta">
                          {selectedReg.descripcion}
                        </div>
                      )}
                      <div className="panel-amount">
                        {fmtARSFull(selectedReg.importe)}
                      </div>
                      <div className="panel-vence">
                        Liq. {selectedReg.numero} — Vence el {selectedReg.vence}
                      </div>
                      {selectedEstadoObj &&
                        selectedMeta.estado !== "Sin información" && (
                          <div style={{ marginBottom: 14 }}>
                            <span
                              className="estado-preview"
                              style={{
                                background: selectedEstadoObj.bg,
                                color: selectedEstadoObj.color,
                              }}
                            >
                              {selectedMeta.estado}
                            </span>
                            {esExcluido(selectedMeta.estado) && (
                              <span
                                className="excluido-badge"
                                style={{ marginLeft: 6 }}
                              >
                                No incluido en cálculos
                              </span>
                            )}
                          </div>
                        )}
                      <div className="panel-divider" />
                      <div className="panel-field">
                        <div className="panel-field-label">Estado de cobro</div>
                        <select
                          className="panel-select"
                          value={selectedMeta.estado}
                          onChange={(e) =>
                            updateMeta(selectedId, "estado", e.target.value)
                          }
                        >
                          {ESTADOS.map((est) => (
                            <option key={est.label} value={est.label}>
                              {est.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {selectedMeta.estado === "Pago parcial" && (
                        <div className="panel-field">
                          <div className="panel-field-label">
                            Monto cobrado hasta ahora
                          </div>
                          <input
                            type="number"
                            className="panel-input"
                            placeholder="Ingresá el monto cobrado"
                            value={selectedMeta.montoParcial || ""}
                            onChange={(e) =>
                              updateMeta(
                                selectedId,
                                "montoParcial",
                                e.target.value
                              )
                            }
                          />
                          {montoParcialNum > 0 && (
                            <>
                              <div className="cobrado-box">
                                <div className="cobrado-box-label">Cobrado</div>
                                <div className="cobrado-box-value">
                                  {fmtARSFull(montoParcialNum)}
                                </div>
                              </div>
                              <div className="saldo-box">
                                <div className="saldo-box-label">
                                  Saldo a reclamar
                                </div>
                                <div className="saldo-box-value">
                                  {fmtARSFull(
                                    selectedReg.importe - montoParcialNum
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      <div className="panel-field">
                        <div className="panel-field-label">
                          Metodología de cobro
                          {requiereMetodo && (
                            <span className="required-star">OBLIGATORIO</span>
                          )}
                        </div>
                        <select
                          className={`panel-select${
                            metodoFaltante ? " required-error" : ""
                          }`}
                          value={selectedMeta.metodologia}
                          onChange={(e) =>
                            updateMeta(
                              selectedId,
                              "metodologia",
                              e.target.value
                            )
                          }
                        >
                          {METODOLOGIAS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        {metodoFaltante && (
                          <div className="required-msg">
                            Seleccioná cómo pagó para poder continuar
                          </div>
                        )}
                      </div>
                      {REQUIERE_FECHA_COBRO.includes(selectedMeta.estado) && (
                        <div className="panel-field">
                          <div className="panel-field-label">
                            Fecha de cobro
                            <span className="required-star">OBLIGATORIO</span>
                          </div>
                          <input
                            type="date"
                            className={`panel-input${
                              fechaFaltante ? " required-error" : ""
                            }`}
                            value={toInputDate(selectedMeta.fechaCobro) || ""}
                            onChange={(e) =>
                              updateMeta(
                                selectedId,
                                "fechaCobro",
                                e.target.value
                              )
                            }
                          />
                          {fechaFaltante && (
                            <div className="required-msg">
                              Ingresá la fecha de cobro para poder continuar
                            </div>
                          )}
                          {delayCobro !== null && (
                            <div
                              className={`delay-chip ${
                                delayCobro <= 0
                                  ? "delay-ok"
                                  : delayCobro <= 7
                                  ? "delay-warn"
                                  : "delay-bad"
                              }`}
                              style={{
                                marginTop: 8,
                                display: "inline-block",
                                padding: "4px 12px",
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {delayCobro < 0
                                ? `Pagó ${Math.abs(delayCobro)} días antes`
                                : delayCobro === 0
                                ? "Pagó en término"
                                : `Pagó ${delayCobro} días después`}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="panel-field">
                        <div className="panel-field-label">Comentarios</div>
                        <textarea
                          className="panel-textarea"
                          placeholder="Notas sobre este comprobante..."
                          value={selectedMeta.comentario}
                          onChange={(e) =>
                            updateMeta(selectedId, "comentario", e.target.value)
                          }
                        />
                      </div>
                      <div className="panel-divider" />
                      <div
                        style={{ fontSize: 10, color: "#ccc", lineHeight: 1.8 }}
                      >
                        {selectedReg.comisionista && (
                          <div>Comisionista: {selectedReg.comisionista}</div>
                        )}
                        {selectedMeta.ultimoEditor && (
                          <div>
                            Editado por: {selectedMeta.ultimoEditor} —{" "}
                            {selectedMeta.ultimaEdicion}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
