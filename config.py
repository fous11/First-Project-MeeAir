import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "77e780ddcb8f22a0da568da7cf6e219eadad66111f266ed50e7f2f25626602a2"
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or "sqlite:///database.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False