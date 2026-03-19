import React, { useState, useEffect, useCallback, FormEvent, ReactNode } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { db, auth } from './firebase';
import { Zap, Plus, Trash2, Users, RotateCcw, X, Edit2, LogIn, LogOut, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Handling Types & Helpers ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Ha ocurrido un error inesperado.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = "No tienes permisos para realizar esta acción o acceder a estos datos.";
        }
      } catch {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-500/50 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl shadow-red-500/10">
            <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
            <h2 className="text-xl font-bold text-white mb-2">¡Ups! Algo salió mal</h2>
            <p className="text-zinc-400 mb-6">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 px-6 rounded-xl transition-all"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Class {
  id: string;
  name: string;
  ownerId: string;
}

interface Student {
  id: string;
  name: string;
  color: string;
  hearts: number;
  classId: string;
  ownerId: string;
}

const COLORS = [
  { name: 'Rojo', value: 'bg-red-500', text: 'text-red-500' },
  { name: 'Azul', value: 'bg-blue-500', text: 'text-blue-500' },
  { name: 'Verde', value: 'bg-emerald-500', text: 'text-emerald-500' },
  { name: 'Amarillo', value: 'bg-yellow-400', text: 'text-yellow-400' },
  { name: 'Rosa', value: 'bg-pink-500', text: 'text-pink-500' },
  { name: 'Morado', value: 'bg-purple-500', text: 'text-purple-500' },
  { name: 'Naranja', value: 'bg-orange-500', text: 'text-orange-500' },
  { name: 'Cian', value: 'bg-cyan-500', text: 'text-cyan-500' },
];

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [classes, setClasses] = useState<Class[]>([]);
  const [currentClassId, setCurrentClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [newClassName, setNewClassName] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLORS[0].value);
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [isEditingClass, setIsEditingClass] = useState(false);
  const [editingClassName, setEditingClassName] = useState('');
  const [isEditingStudent, setIsEditingStudent] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      // If user logs in, create/update their user document
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const docSnap = await getDoc(userRef);
          if (!docSnap.exists()) {
            // New user: set default role
            await setDoc(userRef, {
              name: currentUser.displayName,
              email: currentUser.email,
              role: 'user',
              lastLogin: serverTimestamp()
            });
          } else {
            // Existing user: update info but preserve role
            await updateDoc(userRef, {
              name: currentUser.displayName,
              email: currentUser.email,
              lastLogin: serverTimestamp()
            });
          }
        } catch (err) {
          console.error("Error updating user doc:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Test connection
  useEffect(() => {
    if (!isAuthReady || !user) return;
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, [isAuthReady, user]);

  // Listen for classes
  useEffect(() => {
    if (!isAuthReady || !user) {
      setClasses([]);
      return;
    }
    const q = query(
      collection(db, 'classes'), 
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const classesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class));
      setClasses(classesData);
      if (classesData.length > 0 && !currentClassId) {
        setCurrentClassId(classesData[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'classes');
    });
    return () => unsubscribe();
  }, [isAuthReady, user, currentClassId]);

  // Listen for students in current class
  useEffect(() => {
    if (!isAuthReady || !user || !currentClassId) {
      setStudents([]);
      return;
    }
    const q = query(
      collection(db, 'students'), 
      where('classId', '==', currentClassId),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const studentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
      setStudents(studentsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'students');
    });
    return () => unsubscribe();
  }, [isAuthReady, user, currentClassId]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentClassId(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleAddClass = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newClassName.trim()) return;
    try {
      const docRef = await addDoc(collection(db, 'classes'), {
        name: newClassName,
        createdAt: serverTimestamp(),
        ownerId: user.uid
      });
      setCurrentClassId(docRef.id);
      setNewClassName('');
      setIsAddingClass(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'classes');
    }
  };

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !currentClassId) return;

    if (isBulkMode) {
      if (!bulkImportText.trim()) return;
      const names = bulkImportText
        .split('\n')
        .map(line => {
          const cleanedLine = line
            .replace(/[0-9]/g, '')
            .replace(/^[\s\.\-\)\:]+/, '')
            .trim();
          
          if (cleanedLine.includes(',')) {
            const [surnames, name] = cleanedLine.split(',').map(part => part.trim());
            return `${name} ${surnames}`.trim();
          }
          return cleanedLine;
        })
        .filter(name => name.length > 0);

      try {
        const promises = names.map(name => {
          const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)].value;
          return addDoc(collection(db, 'students'), {
            name,
            color: randomColor,
            hearts: 5,
            classId: currentClassId,
            ownerId: user.uid,
            createdAt: serverTimestamp(),
          });
        });
        await Promise.all(promises);
        setBulkImportText('');
        setIsAddingStudent(false);
        setIsBulkMode(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'students (bulk)');
      }
      return;
    }

    if (!newStudentName.trim()) return;
    const cleanedName = newStudentName
      .replace(/[0-9]/g, '')
      .replace(/^[\s\.\-\)\:]+/, '')
      .trim();
    
    if (!cleanedName) return;

    try {
      await addDoc(collection(db, 'students'), {
        name: cleanedName,
        color: selectedColor,
        hearts: 5,
        classId: currentClassId,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });
      setNewStudentName('');
      setIsAddingStudent(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'students');
    }
  };

  const handleEditClass = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !currentClassId || !editingClassName.trim()) return;
    try {
      await updateDoc(doc(db, 'classes', currentClassId), {
        name: editingClassName,
      });
      setIsEditingClass(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `classes/${currentClassId}`);
    }
  };

  const handleEditStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !editingStudent || !editingStudent.name.trim()) return;
    
    const cleanedName = editingStudent.name
      .replace(/[0-9]/g, '')
      .replace(/^[\s\.\-\)\:]+/, '')
      .trim();
    
    if (!cleanedName) return;

    try {
      await updateDoc(doc(db, 'students', editingStudent.id), {
        name: cleanedName,
        color: editingStudent.color,
      });
      setIsEditingStudent(false);
      setEditingStudent(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${editingStudent.id}`);
    }
  };

  const removePower = async (student: Student) => {
    if (!user || student.hearts <= 0) return;
    try {
      await updateDoc(doc(db, 'students', student.id), {
        hearts: student.hearts - 1
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${student.id}`);
    }
  };

  const resetPower = async (student: Student) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'students', student.id), {
        hearts: 5
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${student.id}`);
    }
  };

  const deleteStudent = async (id: string) => {
    if (!user || !confirm("¿Eliminar alumno?")) return;
    try {
      await deleteDoc(doc(db, 'students', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students/${id}`);
    }
  };

  const deleteClass = async (id: string) => {
    if (!user || !confirm("¿Eliminar esta clase y todos sus alumnos?")) return;
    try {
      const q = query(collection(db, 'students'), where('classId', '==', id), where('ownerId', '==', user.uid));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(studentDoc => deleteDoc(doc(db, 'students', studentDoc.id)));
      await Promise.all(deletePromises);
      
      await deleteDoc(doc(db, 'classes', id));
      
      if (currentClassId === id) {
        setCurrentClassId(classes.find(c => c.id !== id)?.id || null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `classes/${id}`);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/20">
              <Zap className="text-white fill-white" size={40} />
            </div>
            <h1 className="text-4xl font-black tracking-tighter">Pizarra de Poder</h1>
            <p className="text-zinc-500">Gestiona la energía de tus alumnos en tiempo real.</p>
          </div>
          
          <button 
            onClick={handleLogin}
            className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-200 transition-all active:scale-95 shadow-xl"
          >
            <LogIn size={20} />
            Entrar con Google
          </button>
          
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
            Usa tu cuenta de Google para guardar tus clases de forma segura.
          </p>
        </div>
      </div>
    );
  }

  const currentClass = classes.find(c => c.id === currentClassId);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="text-white fill-white" size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">Pizarra de Poder</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[40vw] sm:max-w-[50vw]">
              {classes.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCurrentClassId(c.id)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 group",
                    currentClassId === c.id 
                      ? "bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/20" 
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                  )}
                >
                  {c.name}
                  {currentClassId === c.id && (
                    <div className="flex items-center gap-1">
                      <span 
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingClassName(c.name);
                          setIsEditingClass(true);
                        }}
                        className="p-0.5 hover:bg-black/20 rounded-md transition-colors"
                        title="Editar nombre"
                      >
                        <Edit2 size={14} />
                      </span>
                      <span 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteClass(c.id);
                        }}
                        className="p-0.5 hover:bg-black/20 rounded-md transition-colors"
                        title="Eliminar clase"
                      >
                        <Trash2 size={14} />
                      </span>
                    </div>
                  )}
                </button>
              ))}
              <button 
                onClick={() => setIsAddingClass(true)}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors text-emerald-500 flex-shrink-0"
                title="Nueva Clase"
              >
                <Plus size={20} />
              </button>
            </div>

            <div className="h-8 w-px bg-zinc-800 mx-2 hidden sm:block" />

            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-bold text-white truncate max-w-[100px]">{user.displayName}</p>
                <button onClick={handleLogout} className="text-[10px] text-zinc-500 hover:text-red-500 uppercase tracking-widest font-bold transition-colors">Salir</button>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-zinc-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">
                  {user.displayName?.charAt(0)}
                </div>
              )}
              <button onClick={handleLogout} className="sm:hidden p-2 text-zinc-500 hover:text-red-500">
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Class Content */}
        {currentClassId ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-white">{currentClass?.name}</h2>
                <p className="text-zinc-500 text-sm mt-1">{students.length} alumnos registrados</p>
              </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsCompact(!isCompact)}
                className={cn(
                  "p-2.5 rounded-xl transition-all flex items-center gap-2 font-bold text-xs active:scale-95",
                  isCompact 
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
                    : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700"
                )}
                title={isCompact ? "Vista normal" : "Vista compacta"}
              >
                <Users size={18} />
                <span className="hidden sm:inline">{isCompact ? "Vista Normal" : "Vista Compacta"}</span>
              </button>
              <button 
                onClick={() => setIsAddingStudent(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95"
              >
                <Plus size={20} />
                <span className="hidden sm:inline">Añadir Alumno</span>
              </button>
            </div>
            </div>

            {/* Students Grid */}
            <div className={cn(
              "grid gap-4",
              isCompact 
                ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8" 
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            )}>
              {students.map(student => (
                <div 
                  key={student.id}
                  className={cn(
                    "relative group bg-zinc-900 border border-zinc-800 rounded-2xl transition-all duration-500 overflow-hidden",
                    isCompact ? "p-3" : "p-6",
                    student.hearts === 0 ? "opacity-40 grayscale brightness-50" : "hover:border-zinc-700 hover:shadow-2xl hover:shadow-black/50"
                  )}
                >
                  {/* Background Glow */}
                  <div className={cn(
                    "absolute -top-24 -right-24 blur-[100px] opacity-20 transition-opacity duration-500",
                    isCompact ? "w-24 h-24" : "w-48 h-48",
                    student.hearts > 0 ? student.color : "bg-zinc-800"
                  )} />

                  <div className={cn("relative flex flex-col", isCompact ? "gap-2" : "gap-4")}>
                    <div className="flex items-start justify-between">
                      <h3 className={cn(
                        "font-black uppercase tracking-tighter transition-colors duration-500 truncate",
                        isCompact ? "text-sm" : "text-2xl",
                        student.hearts > 0 ? COLORS.find(c => c.value === student.color)?.text || 'text-white' : "text-zinc-500"
                      )}>
                        {student.name}
                      </h3>
                      <div className="flex gap-0.5">
                        <button 
                          onClick={() => {
                            setEditingStudent({...student});
                            setIsEditingStudent(true);
                          }}
                          className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-emerald-500 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={isCompact ? 12 : 16} />
                        </button>
                        <button 
                          onClick={() => resetPower(student)}
                          className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-emerald-500 transition-colors"
                          title="Reiniciar poder"
                        >
                          <RotateCcw size={isCompact ? 12 : 16} />
                        </button>
                        <button 
                          onClick={() => deleteStudent(student.id)}
                          className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={isCompact ? 12 : 16} />
                        </button>
                      </div>
                    </div>
 
                    {/* Power Bar Display */}
                    <div className={isCompact ? "py-2" : "py-6"}>
                      <button
                        onClick={() => removePower(student)}
                        disabled={student.hearts === 0}
                        className={cn(
                          "w-full group/bar relative bg-zinc-800 rounded-full overflow-hidden border border-zinc-700/50 transition-all active:scale-[0.98]",
                          isCompact ? "h-4" : "h-8"
                        )}
                      >
                        {/* Progress Fill */}
                        <div 
                          className={cn(
                            "absolute inset-y-0 left-0 transition-all duration-700 ease-out",
                            student.hearts > 0 ? student.color : "bg-zinc-700"
                          )}
                          style={{ width: `${(student.hearts / 5) * 100}%` }}
                        >
                          {/* Animated Shine Effect */}
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/bar:animate-[shimmer_2s_infinite]" />
                        </div>

                        {/* Percentage Text */}
                        {!isCompact && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white drop-shadow-md">
                              {student.hearts * 20}%
                            </span>
                          </div>
                        )}
                      </button>
                    </div>

                    {student.hearts === 0 && !isCompact && (
                      <div className="text-center">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500/50">Sin energía</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {students.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-zinc-800 rounded-3xl">
                <Users className="text-zinc-700 mb-4" size={48} />
                <p className="text-zinc-500 font-medium">No hay alumnos en esta clase</p>
                <button 
                  onClick={() => setIsAddingStudent(true)}
                  className="mt-4 text-emerald-500 hover:text-emerald-400 font-bold flex items-center gap-2"
                >
                  <Plus size={20} />
                  Añadir el primero
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mb-6 border border-zinc-800">
              <Users className="text-zinc-500" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Bienvenido a Pizarra de Poder</h2>
            <p className="text-zinc-500 max-w-md mb-8">
              Crea tu primera clase para empezar a gestionar la energía de tus alumnos en tiempo real.
            </p>
            <button 
              onClick={() => setIsAddingClass(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-8 py-3 rounded-2xl transition-all shadow-xl shadow-emerald-500/20"
            >
              Crear mi primera clase
            </button>
          </div>
        )}
      </main>

      {/* Modals */}
      {isAddingClass && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Nueva Clase</h3>
              <button onClick={() => setIsAddingClass(false)} className="text-zinc-500 hover:text-white">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddClass} className="space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Nombre de la clase</label>
                <input 
                  autoFocus
                  type="text" 
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="Ej: 3º Primaria A"
                  className="w-full bg-zinc-800 border-none rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-3 rounded-xl transition-all">
                Crear Clase
              </button>
            </form>
          </div>
        </div>
      )}

      {isAddingStudent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">{isBulkMode ? 'Importar Lista' : 'Añadir Alumno'}</h3>
              <button onClick={() => { setIsAddingStudent(false); setIsBulkMode(false); }} className="text-zinc-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="flex bg-zinc-800 p-1 rounded-xl mb-6">
              <button 
                onClick={() => setIsBulkMode(false)}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  !isBulkMode ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Individual
              </button>
              <button 
                onClick={() => setIsBulkMode(true)}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  isBulkMode ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Lista (Pegar PDF)
              </button>
            </div>

            <form onSubmit={handleAddStudent} className="space-y-6">
              {isBulkMode ? (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Pegar lista (Apellidos, Nombre - uno por línea)</label>
                  <textarea 
                    autoFocus
                    value={bulkImportText}
                    onChange={(e) => setBulkImportText(e.target.value)}
                    placeholder="Pérez García, Juan&#10;López Martínez, María&#10;García Ruiz, Carlos..."
                    rows={8}
                    className="w-full bg-zinc-800 border-none rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none resize-none text-sm"
                  />
                  <p className="text-[10px] text-zinc-500 mt-2 italic">El sistema convertirá "Apellidos, Nombre" a "Nombre Apellidos" automáticamente.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Nombre del alumno</label>
                    <input 
                      autoFocus
                      type="text" 
                      value={newStudentName}
                      onChange={(e) => setNewStudentName(e.target.value)}
                      placeholder="Ej: Juan Pérez"
                      className="w-full bg-zinc-800 border-none rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Color distintivo</label>
                    <div className="grid grid-cols-4 gap-2">
                      {COLORS.map(color => (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => setSelectedColor(color.value)}
                          className={cn(
                            "h-10 rounded-lg transition-all border-2",
                            color.value,
                            selectedColor === color.value ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
              <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-3 rounded-xl transition-all">
                {isBulkMode ? 'Importar Alumnos' : 'Añadir Alumno'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isEditingClass && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Editar Clase</h3>
              <button onClick={() => setIsEditingClass(false)} className="text-zinc-500 hover:text-white">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditClass} className="space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Nombre de la clase</label>
                <input 
                  autoFocus
                  type="text" 
                  value={editingClassName}
                  onChange={(e) => setEditingClassName(e.target.value)}
                  className="w-full bg-zinc-800 border-none rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20">
                Guardar Cambios
              </button>
            </form>
          </div>
        </div>
      )}

      {isEditingStudent && editingStudent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Editar Alumno</h3>
              <button onClick={() => setIsEditingStudent(false)} className="text-zinc-500 hover:text-white">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditStudent} className="space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Nombre del alumno</label>
                <input 
                  autoFocus
                  type="text" 
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({...editingStudent, name: e.target.value})}
                  className="w-full bg-zinc-800 border-none rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Color de energía</label>
                <div className="grid grid-cols-4 gap-3">
                  {COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setEditingStudent({...editingStudent, color: color.value})}
                      className={cn(
                        "h-10 rounded-lg transition-all border-2",
                        color.value,
                        editingStudent.color === color.value ? "border-white scale-110 shadow-lg" : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    />
                  ))}
                </div>
              </div>
              <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20">
                Guardar Cambios
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
