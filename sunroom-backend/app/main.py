from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import catalog, sessions, generate

app = FastAPI(title="Sunroom API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog.router,  prefix="/catalog",  tags=["Catalog"])
app.include_router(sessions.router, prefix="/sessions", tags=["Sessions"])
app.include_router(generate.router, prefix="/generate", tags=["Generate"])

@app.get("/")
def health_check():
    return {"status": "ok"}