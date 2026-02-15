# 🎯 SIMULACIÓN DE VPS EN WSL

Guía para simular un despliegue real desde Git.

---

## 📋 Pasos Previos

### 1. Subir código a GitHub

Desde Windows (PowerShell en tu proyecto):

```powershell
# Inicializar git si no lo has hecho
git init

# Agregar archivos
git add .

# Commit
git commit -m "Sistema listo para producción"

# Crear repositorio en GitHub y conectar
git remote add origin https://github.com/tu-usuario/restaurante-pro.git

# Subir código
git push -u origin main
```

---

## 🚀 SIMULACIÓN EN WSL (Como si fuera VPS)

### 1. Abrir WSL Ubuntu

```bash
wsl
```

### 2. Simular entorno limpio de VPS

```bash
# Ir a directorio "servidor"
cd ~
mkdir -p servidor
cd servidor

# Limpiar cualquier instalación previa
rm -rf restaurante-pro
```

### 3. Clonar desde GitHub (como en VPS real)

```bash
git clone https://github.com/tu-usuario/restaurante-pro.git
cd restaurante-pro
```

### 4. Ejecutar instalación automática

```bash
chmod +x install-wsl-docker.sh
./install-wsl-docker.sh
```

O si quieres simular con dominio:

```bash
chmod +x install-auto.sh
./install-auto.sh localhost admin@localhost.com
```

### 5. Acceder desde Windows

```
http://localhost:3000
```

---

## 🔄 Simular actualización (como en VPS)

```bash
cd ~/servidor/restaurante-pro

# Actualizar código
git pull

# Redesplegar
docker-compose down
docker-compose build
docker-compose up -d
```

---

## 📊 Comandos útiles (como en VPS)

```bash
# Ver logs
docker-compose logs -f

# Ver estado
docker-compose ps

# Reiniciar
docker-compose restart

# Detener
docker-compose down

# Ver recursos
docker stats
```

---

## ✅ Ventajas de esta simulación

- ✅ Proceso idéntico al VPS real
- ✅ Pruebas de instalación desde Git
- ✅ Verificar que todos los archivos están en el repo
- ✅ Detectar problemas antes de producción
- ✅ Practicar comandos de administración

---

## 🎯 Cuando estés listo para VPS real

El proceso será EXACTAMENTE igual:

```bash
# Conectar al VPS
ssh root@157.137.229.217

# Clonar
git clone https://github.com/tu-usuario/restaurante-pro.git
cd restaurante-pro

# Instalar
./install-auto.sh restaurante admin@tudominio.com
```

La única diferencia será el dominio real en lugar de localhost.
