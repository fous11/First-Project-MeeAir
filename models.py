from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime, timedelta

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    email_confirmation_code = db.Column(db.String(6), nullable=True)
    email_confirmed = db.Column(db.Boolean, default=False)
    currency = db.Column(db.String(10), default="EUR")
    phone = db.Column(db.String(50), nullable=True)
    avatar_color = db.Column(db.String(20), default="#1e90d4")
    is_admin = db.Column(db.Boolean, default=False)
    bookings = db.relationship('Booking', backref='user', lazy=True)

class Country(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    airports = db.relationship('Airport', backref='country', lazy=True)

class Airport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(10), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    city = db.Column(db.String(100), nullable=False)
    country_id = db.Column(db.Integer, db.ForeignKey('country.id'), nullable=False)

class Flight(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    flight_number = db.Column(db.String(20), unique=True, nullable=False)
    airline = db.Column(db.String(100), nullable=False)
    from_airport_id = db.Column(db.Integer, db.ForeignKey('airport.id'), nullable=False)
    to_airport_id = db.Column(db.Integer, db.ForeignKey('airport.id'), nullable=False)
    departure_time = db.Column(db.String(10), nullable=False)  # HH:MM
    arrival_time = db.Column(db.String(10), nullable=False)
    duration = db.Column(db.String(20), nullable=False)
    base_price = db.Column(db.Float, nullable=False)  # эконом
    seats_eco = db.Column(db.Integer, default=0)
    seats_mid = db.Column(db.Integer, default=0)
    seats_biz = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default='active')  # active/cancelled/delayed

    from_airport = db.relationship('Airport', foreign_keys=[from_airport_id])
    to_airport = db.relationship('Airport', foreign_keys=[to_airport_id])
    bookings = db.relationship('Booking', backref='flight', lazy=True, passive_deletes=True)

class Booking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    flight_id = db.Column(db.Integer, db.ForeignKey('flight.id'), nullable=False)
    ref = db.Column(db.String(20), unique=True, nullable=False)
    flight_class = db.Column(db.String(10), nullable=False)  # eco/mid/biz
    seat = db.Column(db.String(10))
    services = db.Column(db.String(200))  # comma separated service keys
    passenger_name = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(150), nullable=False)
    phone = db.Column(db.String(50))
    total_price = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='Confirmed')
    departure_date = db.Column(db.Date, nullable=True)
    passengers = db.Column(db.Integer, default=1)
    return_date = db.Column(db.Date, nullable=True)

    def can_edit(self):
        """Проверяет, можно ли редактировать бронирование (больше 12 часов до вылета)."""
        if not self.departure_date or not self.flight:
            return False
        # Собираем полное время вылета
        dep_time = datetime.strptime(self.flight.departure_time, "%H:%M").time()
        departure_datetime = datetime.combine(self.departure_date, dep_time)
        return departure_datetime - datetime.utcnow() > timedelta(hours=12)

class CurrencyRate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    currency = db.Column(db.String(10), unique=True, nullable=False)  # USD, RUB
    rate = db.Column(db.Float, nullable=False)  # сколько единиц за 1 EUR