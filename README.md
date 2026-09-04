# Gimnasio App Backend

Backend API para el Asistente Personal de Entrenamiento Físico Familiar e Inteligente. Construido con FastAPI, SQLAlchemy y soporte para SQLite (desarrollo) y PostgreSQL (producción).

## Características

- **Clean Architecture**: Estructura modular y escalable
- **FastAPI**: Framework moderno y de alto rendimiento
- **SQLAlchemy**: ORM potente con soporte para múltiples bases de datos
- **Alembic**: Sistema de migraciones de base de datos
- **Pydantic**: Validación de datos con schemas
- **OpenAPI/Swagger**: Documentación automática de la API

## Modelos de Datos

### User (Usuario)
- Información personal y objetivos de entrenamiento
- Embeddings faciales para reconocimiento
- Limitaciones físicas y RPE objetivo

### Equipment (Equipamiento)
- Inventario de equipos disponibles en el hogar
- Categorización por tipo (peso libre, peso corporal, máquina, accesorio)

### Exercise (Ejercicios)
- Biblioteca de ejercicios con descripciones
- Músculos objetivo y equipos requeridos
- Configuración de puntos clave para MediaPipe

### WorkoutSession (Sesiones)
- Modos: solo, dueto, grupo
- Seguimiento de tiempo y estado

### WorkoutLog (Registros)
- Detalles por serie y usuario
- Repeticiones, peso y RPE reportado

## Instalación

### 1. Crear entorno virtual

```bash
python -m venv venv
venv\Scripts\activate  # Windows
# o
source venv/bin/activate  # Linux/Mac
```

### 2. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 3. Configurar base de datos

Por defecto usa SQLite para desarrollo local. Para producción con PostgreSQL:

```bash
# Crear archivo .env
DATABASE_URL=postgresql://user:password@localhost/gimnasio_db
```

### 4. Ejecutar migraciones

```bash
alembic upgrade head
```

### 5. Poblar base de datos con datos de prueba

```bash
python seed.py
```

Esto creará:
- 2 usuarios de familia
- 3 equipos típicos de casa
- 5 ejercicios básicos

## Ejecución

### Iniciar servidor de desarrollo

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Acceder a la documentación

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

## API Endpoints

### Users
- `POST /api/v1/users/` - Crear usuario
- `GET /api/v1/users/` - Listar usuarios
- `GET /api/v1/users/{user_id}` - Obtener usuario
- `PUT /api/v1/users/{user_id}` - Actualizar usuario
- `DELETE /api/v1/users/{user_id}` - Eliminar usuario

### Equipment
- `POST /api/v1/equipment/` - Crear equipo
- `GET /api/v1/equipment/` - Listar equipos
- `GET /api/v1/equipment/{equipment_id}` - Obtener equipo
- `PUT /api/v1/equipment/{equipment_id}` - Actualizar equipo
- `DELETE /api/v1/equipment/{equipment_id}` - Eliminar equipo

### Exercises
- `POST /api/v1/exercises/` - Crear ejercicio
- `GET /api/v1/exercises/` - Listar ejercicios
- `GET /api/v1/exercises/{exercise_id}` - Obtener ejercicio
- `PUT /api/v1/exercises/{exercise_id}` - Actualizar ejercicio
- `DELETE /api/v1/exercises/{exercise_id}` - Eliminar ejercicio

### Sessions
- `POST /api/v1/sessions/start` - Iniciar sesión (solo o dueto)
- `POST /api/v1/sessions/{session_id}/log_set` - Registrar serie
- `POST /api/v1/sessions/{session_id}/end` - Finalizar sesión
- `GET /api/v1/sessions/{session_id}` - Obtener sesión
- `GET /api/v1/sessions/` - Listar sesiones

## Estructura del Proyecto

```
gimnasio-app/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── users.py
│   │       │   ├── equipment.py
│   │       │   ├── exercises.py
│   │       │   └── sessions.py
│   │       └── api.py
│   ├── core/
│   │   ├── config.py
│   │   └── database.py
│   ├── models/
│   │   ├── user.py
│   │   ├── equipment.py
│   │   ├── exercise.py
│   │   ├── session.py
│   │   └── workout_log.py
│   ├── schemas/
│   │   ├── user.py
│   │   ├── equipment.py
│   │   ├── exercise.py
│   │   ├── session.py
│   │   └── workout_log.py
│   └── main.py
├── alembic/
│   ├── versions/
│   ├── env.py
│   └── script.py.mako
├── requirements.txt
├── seed.py
└── README.md
```

## Migraciones

### Crear nueva migración

```bash
alembic revision --autogenerate -m "descripción de la migración"
```

### Aplicar migraciones

```bash
alembic upgrade head
```

### Revertir última migración

```bash
alembic downgrade -1
```

## Tecnologías

- **Python 3.8+**
- **FastAPI 0.104.1**
- **SQLAlchemy 2.0.23**
- **Pydantic 2.5.0**
- **Alembic 1.12.1**
- **Uvicorn 0.24.0**

## Desarrollo

### Ejecutar tests

```bash
pytest
```

### Formatear código

```bash
black app/
```

### Linting

```bash
ruff check app/
```

## Licencia

MIT
