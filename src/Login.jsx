import { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";

// Email del admin — único que puede ver el panel de usuarios
const ADMIN_EMAIL = "operaciones@consignatariagalarraga.com";

// ─── Panel de Admin ───────────────────────────────────────────────────────────
export function PanelAdmin({ usuarios, onCerrar }) {
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevaPass, setNuevaPass] = useState("");
  const [creando, setCreando] = useState(false);
  const [errorAdmin, setErrorAdmin] = useState("");
  const [exitoAdmin, setExitoAdmin] = useState("");

  const crearUsuario = async () => {
    if (!nuevoEmail || !nuevaPass) {
      setErrorAdmin("Completá email y contraseña.");
      return;
    }
    if (nuevaPass.length < 6) {
      setErrorAdmin("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setCreando(true);
    setErrorAdmin("");
    setExitoAdmin("");
    try {
      // Crear usuario en Firebase Auth — guarda la sesión del admin
      const adminEmail = auth.currentUser.email;
      const adminUid = auth.currentUser.uid;

      await createUserWithEmailAndPassword(auth, nuevoEmail, nuevaPass);
      // Volver a loguear al admin
      await signOut(auth);
      // Le avisamos que tiene que re-loguearse (limitación sin Admin SDK)
      setExitoAdmin(
        `✅ Usuario ${nuevoEmail} creado. Cerraste sesión — volvé a ingresar.`
      );
      setNuevoEmail("");
      setNuevaPass("");
    } catch (err) {
      const msgs = {
        "auth/email-already-in-use": "Ese email ya está registrado.",
        "auth/invalid-email": "Email inválido.",
        "auth/weak-password": "Contraseña muy débil (mínimo 6 caracteres).",
      };
      setErrorAdmin(msgs[err.code] || "Error al crear usuario.");
    } finally {
      setCreando(false);
    }
  };

  const inp = {
    padding: "9px 12px",
    border: "1.5px solid #333",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "Montserrat, sans-serif",
    background: "#1a1a2e",
    color: "#fff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#12122a",
          borderRadius: 16,
          padding: 32,
          width: 420,
          border: "1px solid #2a2a4a",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
            👤 Panel de administración
          </div>
          <button
            onClick={onCerrar}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: 20,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#888",
            marginBottom: 16,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            fontWeight: 700,
          }}
        >
          Crear nuevo usuario
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <input
            style={inp}
            type="email"
            placeholder="Email"
            value={nuevoEmail}
            onChange={(e) => setNuevoEmail(e.target.value)}
          />
          <input
            style={inp}
            type="password"
            placeholder="Contraseña (mín. 6 caracteres)"
            value={nuevaPass}
            onChange={(e) => setNuevaPass(e.target.value)}
          />
        </div>

        {errorAdmin && (
          <div
            style={{
              padding: "8px 12px",
              background: "#3a1a1a",
              border: "1px solid #E8335A",
              borderRadius: 8,
              color: "#E8335A",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {errorAdmin}
          </div>
        )}
        {exitoAdmin && (
          <div
            style={{
              padding: "8px 12px",
              background: "#1a3a1a",
              border: "1px solid #1DB954",
              borderRadius: 8,
              color: "#1DB954",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {exitoAdmin}
          </div>
        )}

        <button
          onClick={crearUsuario}
          disabled={creando}
          style={{
            width: "100%",
            padding: "11px",
            background: creando ? "#333" : "#1877F2",
            color: "#fff",
            border: "none",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "Montserrat, sans-serif",
            cursor: creando ? "not-allowed" : "pointer",
          }}
        >
          {creando ? "Creando..." : "Crear usuario"}
        </button>

        <div
          style={{
            marginTop: 20,
            padding: "12px 14px",
            background: "#1a1a3a",
            borderRadius: 8,
            fontSize: 12,
            color: "#888",
            lineHeight: 1.6,
          }}
        >
          ℹ️ Al crear un usuario nuevo, tu sesión se cierra automáticamente.
          Volvé a ingresar con tus credenciales.
        </div>
      </div>
    </div>
  );
}

// ─── Pantalla de Login ────────────────────────────────────────────────────────
export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Completá email y contraseña.");
      return;
    }
    setCargando(true);
    setError("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      onLogin(cred.user);
    } catch (err) {
      const msgs = {
        "auth/invalid-credential": "Email o contraseña incorrectos.",
        "auth/invalid-email": "Email inválido.",
        "auth/user-disabled":
          "Usuario deshabilitado. Contactá al administrador.",
        "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
      };
      setError(msgs[err.code] || "Error al iniciar sesión.");
    } finally {
      setCargando(false);
    }
  };

  const inp = {
    padding: "12px 14px",
    border: "1.5px solid #2a2a4a",
    borderRadius: 10,
    fontSize: 14,
    fontFamily: "Montserrat, sans-serif",
    background: "#1a1a2e",
    color: "#fff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Montserrat, sans-serif",
      }}
    >
      {/* Fondo decorativo */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-20%",
            left: "-10%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(24,119,242,0.12) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-20%",
            right: "-10%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(29,185,84,0.08) 0%, transparent 70%)",
          }}
        />
      </div>

      <div
        style={{
          background: "#12122a",
          borderRadius: 20,
          padding: "40px 36px",
          width: 380,
          border: "1px solid #2a2a4a",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Logo / título */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "linear-gradient(135deg, #1877F2, #0ea5e9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              margin: "0 auto 16px",
              boxShadow: "0 8px 24px rgba(24,119,242,0.3)",
            }}
          >
            🐄
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 4,
            }}
          >
            Consignataria Galarraga
          </div>
          <div style={{ fontSize: 13, color: "#666" }}>
            Seguimiento de Cobranzas
          </div>
        </div>

        {/* Formulario */}
        <form
          onSubmit={handleLogin}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Email
            </div>
            <input
              style={inp}
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Contraseña
            </div>
            <input
              style={inp}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "#2a1a1a",
                border: "1px solid #E8335A",
                borderRadius: 8,
                color: "#E8335A",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            style={{
              marginTop: 4,
              padding: "13px",
              width: "100%",
              background: cargando
                ? "#333"
                : "linear-gradient(135deg, #1877F2, #0ea5e9)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "Montserrat, sans-serif",
              cursor: cargando ? "not-allowed" : "pointer",
              boxShadow: cargando ? "none" : "0 4px 16px rgba(24,119,242,0.3)",
              transition: "all 0.2s",
            }}
          >
            {cargando ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 12,
            color: "#444",
          }}
        >
          Sistema interno — acceso restringido
        </div>
      </div>

      {showAdmin && <PanelAdmin onCerrar={() => setShowAdmin(false)} />}
    </div>
  );
}
