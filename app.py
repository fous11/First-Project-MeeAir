from flask import Flask, render_template, request, jsonify
from models import db, User, Country, Airport, Flight, Booking, CurrencyRate
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from config import Config
from datetime import datetime
import random
import re

app = Flask(__name__)
app.config.from_object(Config)

db.init_app(app)

login_manager = LoginManager()
login_manager.init_app(app)

CLASS_MULTIPLIERS = {'eco': 1, 'mid': 1.35, 'biz': 2.1}
SERVICE_PRICES = {'bag': 25, 'ins': 15, 'meal': 10, 'wifi': 8, 'priority': 20}
SERVICE_LABELS = {
    'bag': 'Багаж 20 кг', 'ins': 'Страховка', 'meal': 'Горячее питание',
    'wifi': 'Wi-Fi', 'priority': 'Приоритетная посадка',
}


def seat_zone(seat):
    if not seat:
        return 'eco'
    row_str = ''.join(c for c in seat if c.isdigit())
    row = int(row_str) if row_str else 99
    return 'biz' if row <= 3 else 'mid' if row <= 7 else 'eco'


def user_to_dict(user):
    return {
        'id': user.id,
        'name': user.username,
        'email': user.email,
        'is_admin': user.is_admin,
        'phone': user.phone or '',
        'currency': user.currency or 'EUR',
        'avatar_color': user.avatar_color or '#1e90d4',
    }


def calculate_total(flight, flight_class, services, passengers=1):
    base = flight.base_price * CLASS_MULTIPLIERS.get(flight_class, 1)
    svc = sum(SERVICE_PRICES.get(s, 0) for s in services)
    return round((base + svc) * max(1, int(passengers)), 2)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/airports')
def get_airports():
    airports = Airport.query.all()
    return jsonify([{
        'code': a.code, 'name': a.name, 'city': a.city,
        'country': a.country.name if a.country else '',
    } for a in airports])


@app.route('/api/flights')
def search_flights():
    from_code = request.args.get('from')
    to_code = request.args.get('to')
    flights_query = Flight.query.filter_by(status='active')
    if from_code:
        from_airport = Airport.query.filter_by(code=from_code).first()
        if from_airport:
            flights_query = flights_query.filter_by(from_airport_id=from_airport.id)
    if to_code:
        to_airport = Airport.query.filter_by(code=to_code).first()
        if to_airport:
            flights_query = flights_query.filter_by(to_airport_id=to_airport.id)
    flights = flights_query.all()
    result = []
    for f in flights:
        booked_seats = {'eco': 0, 'mid': 0, 'biz': 0}
        taken_seat_ids = []
        for b in f.bookings:
            if b.seat:
                taken_seat_ids.append(b.seat)
                zone = seat_zone(b.seat)
                booked_seats[zone] = booked_seats.get(zone, 0) + 1
        result.append({
            'id': f.id,
            'flight_number': f.flight_number,
            'airline': f.airline,
            'from': f.from_airport.code,
            'to': f.to_airport.code,
            'from_city': f.from_airport.city,
            'to_city': f.to_airport.city,
            'departure_time': f.departure_time,
            'arrival_time': f.arrival_time,
            'duration': f.duration,
            'base_price': f.base_price,
            'seats_eco': max(0, f.seats_eco - booked_seats.get('eco', 0)),
            'seats_mid': max(0, f.seats_mid - booked_seats.get('mid', 0)),
            'seats_biz': max(0, f.seats_biz - booked_seats.get('biz', 0)),
            'taken_seats': taken_seat_ids,
        })
    return jsonify(result)


@app.route('/api/flights/<int:flight_id>/seats')
def flight_seats(flight_id):
    flight = Flight.query.get_or_404(flight_id)
    taken = [b.seat for b in flight.bookings if b.seat]
    return jsonify({'taken': taken})


@app.route('/api/bookings', methods=['POST'])
@login_required
def create_booking():
    data = request.get_json() or {}
    flight = Flight.query.get(data.get('flight_id'))
    if not flight or flight.status != 'active':
        return jsonify({'error': 'Рейс недоступен'}), 400

    seat = data.get('seat')
    if seat and any(b.seat == seat for b in flight.bookings):
        return jsonify({'error': 'Место уже занято'}), 400

    flight_class = data.get('class', 'eco')
    if flight_class not in CLASS_MULTIPLIERS:
        return jsonify({'error': 'Некорректный класс'}), 400

    if seat and seat_zone(seat) != flight_class:
        return jsonify({'error': 'Место не соответствует выбранному классу'}), 400

    services = [s for s in data.get('services', []) if s in SERVICE_PRICES]
    passengers = max(1, min(4, int(data.get('passengers', 1))))
    expected_total = calculate_total(flight, flight_class, services, passengers)
    client_total = float(data.get('total_price', 0))
    if abs(client_total - expected_total) > 0.5:
        return jsonify({'error': 'Несоответствие суммы заказа', 'expected': expected_total}), 400

    zone = seat_zone(seat) if seat else flight_class
    booked_in_zone = sum(1 for b in flight.bookings if seat_zone(b.seat) == zone or (not b.seat and b.flight_class == flight_class))
    zone_limits = {'eco': flight.seats_eco, 'mid': flight.seats_mid, 'biz': flight.seats_biz}
    if booked_in_zone >= zone_limits.get(flight_class, 0):
        return jsonify({'error': 'Нет свободных мест в выбранном классе'}), 400

    ref = 'MA-' + ''.join(random.choices('0123456789', k=6))
    while Booking.query.filter_by(ref=ref).first():
        ref = 'MA-' + ''.join(random.choices('0123456789', k=6))

    departure_date_str = data.get('departure_date')
    departure_date = None
    if departure_date_str:
        try:
            departure_date = datetime.strptime(departure_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Некорректная дата вылета'}), 400

    return_date = None
    return_date_str = data.get('return_date')
    if return_date_str:
        try:
            return_date = datetime.strptime(return_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Некорректная дата возврата'}), 400

    booking = Booking(
        user_id=current_user.id,
        flight_id=flight.id,
        ref=ref,
        flight_class=flight_class,
        seat=seat,
        services=','.join(services),
        passenger_name=data.get('passenger_name', '').strip(),
        email=data.get('email', '').strip(),
        phone=data.get('phone', ''),
        total_price=expected_total,
        departure_date=departure_date,
        return_date=return_date,
        passengers=passengers,
    )
    if not booking.passenger_name or not booking.email:
        return jsonify({'error': 'Укажите имя и email пассажира'}), 400

    db.session.add(booking)
    db.session.commit()
    return jsonify({'ref': booking.ref, 'total': booking.total_price}), 201


def booking_to_dict(b):
    return {
        'id': b.id,
        'ref': b.ref,
        'flight_number': b.flight.flight_number,
        'airline': b.flight.airline,
        'route': f"{b.flight.from_airport.code} → {b.flight.to_airport.code}",
        'from': b.flight.from_airport.code,
        'to': b.flight.to_airport.code,
        'departure_time': b.flight.departure_time,
        'arrival_time': b.flight.arrival_time,
        'duration': b.flight.duration,
        'class': b.flight_class,
        'seat': b.seat,
        'services': b.services.split(',') if b.services else [],
        'service_labels': [SERVICE_LABELS.get(s, s) for s in (b.services.split(',') if b.services else [])],
        'passenger_name': b.passenger_name,
        'email': b.email,
        'phone': b.phone,
        'total_price': b.total_price,
        'passengers': getattr(b, 'passengers', 1) or 1,
        'created_at': b.created_at.strftime('%d.%m.%Y'),
        'departure_date': b.departure_date.strftime('%d.%m.%Y') if b.departure_date else None,
        'return_date': b.return_date.strftime('%d.%m.%Y') if getattr(b, 'return_date', None) else None,
        'can_edit': b.can_edit(),
        'base_price': b.flight.base_price,
    }


@app.route('/api/bookings')
@login_required
def my_bookings():
    bookings = Booking.query.filter_by(user_id=current_user.id).order_by(Booking.created_at.desc()).all()
    return jsonify([booking_to_dict(b) for b in bookings if b.flight])


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    user = User.query.filter_by(email=data.get('email', '').strip()).first()
    if not user or not check_password_hash(user.password, data.get('password', '')):
        return jsonify({'error': 'Неверный email или пароль'}), 401
    if not user.email_confirmed and not user.is_admin:
        return jsonify({'error': 'Подтвердите email — проверьте почту или зарегистрируйтесь заново'}), 403
    login_user(user)
    return jsonify(user_to_dict(user))


@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
        return jsonify({'error': 'Некорректный email-адрес'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email уже используется'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Пароль должен быть не менее 6 символов'}), 400

    code = ''.join(random.choices('0123456789', k=6))
    user = User(
        username=username,
        email=email,
        password=generate_password_hash(password),
        email_confirmation_code=code,
        email_confirmed=False,
    )
    db.session.add(user)
    db.session.commit()
    print(f"Код подтверждения для {user.email}: {code}")
    return jsonify({
        'message': 'Код подтверждения отправлен (в консоль сервера).',
        'code': code,
    }), 200


@app.route('/api/auth/confirm-code', methods=['POST'])
def confirm_code():
    data = request.get_json() or {}
    email = data.get('email')
    code = data.get('code')
    if not email or not code:
        return jsonify({'error': 'Email и код обязательны'}), 400
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    if user.email_confirmed:
        return jsonify({'error': 'Email уже подтверждён'}), 400
    if user.email_confirmation_code != code:
        return jsonify({'error': 'Неверный код подтверждения'}), 400
    user.email_confirmed = True
    user.email_confirmation_code = None
    db.session.commit()
    login_user(user)
    return jsonify(user_to_dict(user)), 200


@app.route('/api/auth/logout')
@login_required
def api_logout():
    logout_user()
    return jsonify({'success': True})


@app.route('/api/auth/me')
def api_me():
    if current_user.is_authenticated:
        return jsonify(user_to_dict(current_user))
    return jsonify(None)


@app.route('/api/profile', methods=['PUT'])
@login_required
def update_profile():
    data = request.get_json() or {}
    if 'name' in data:
        current_user.username = data['name'].strip()
    if 'phone' in data:
        current_user.phone = data['phone'].strip()
    if 'currency' in data and data['currency'] in ('EUR', 'USD', 'RUB'):
        current_user.currency = data['currency']
    if 'avatar_color' in data:
        color = data['avatar_color'].strip()
        if re.match(r'^#[0-9A-Fa-f]{6}$', color):
            current_user.avatar_color = color
    if data.get('password'):
        if len(data['password']) < 6:
            return jsonify({'error': 'Пароль должен быть не менее 6 символов'}), 400
        current_user.password = generate_password_hash(data['password'])
    db.session.commit()
    return jsonify(user_to_dict(current_user))


@app.route('/api/rates')
def get_rates():
    rates = {r.currency: r.rate for r in CurrencyRate.query.all()}
    rates['EUR'] = 1.0
    return jsonify(rates)


@app.route('/api/rates', methods=['PUT'])
@login_required
def update_rates():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    data = request.get_json() or {}
    for currency, rate in data.items():
        if currency == 'EUR':
            continue
        cr = CurrencyRate.query.filter_by(currency=currency).first()
        if cr:
            cr.rate = float(rate)
        else:
            db.session.add(CurrencyRate(currency=currency, rate=float(rate)))
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/admin/stats')
@login_required
def admin_stats():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    revenue = db.session.query(db.func.sum(Booking.total_price)).scalar() or 0
    recent_bookings = []
    for b in Booking.query.order_by(Booking.created_at.desc()).limit(10).all():
        if b.flight:
            recent_bookings.append({
                'ref': b.ref, 'passenger_name': b.passenger_name,
                'route': f"{b.flight.from_airport.code} → {b.flight.to_airport.code}",
                'class': b.flight_class, 'seat': b.seat,
                'total_price': b.total_price,
                'created_at': b.created_at.strftime('%d.%m.%Y'),
            })
    return jsonify({
        'total_flights': Flight.query.count(),
        'total_users': User.query.count(),
        'total_bookings': Booking.query.count(),
        'revenue': revenue,
        'recent_bookings': recent_bookings,
    })


@app.route('/api/admin/flights', methods=['GET', 'POST', 'PUT'])
@login_required
def manage_flights():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    if request.method == 'GET':
        flights = Flight.query.all()
        return jsonify([{
            'id': f.id, 'flight_number': f.flight_number, 'airline': f.airline,
            'from': f.from_airport.code, 'to': f.to_airport.code,
            'departure_time': f.departure_time, 'arrival_time': f.arrival_time,
            'duration': f.duration, 'base_price': f.base_price,
            'seats_eco': f.seats_eco, 'seats_mid': f.seats_mid, 'seats_biz': f.seats_biz,
            'status': f.status,
        } for f in flights])
    data = request.get_json() or {}
    from_ap = Airport.query.filter_by(code=data.get('from')).first()
    to_ap = Airport.query.filter_by(code=data.get('to')).first()
    if not from_ap or not to_ap:
        return jsonify({'error': 'Неверные коды аэропортов'}), 400
    if request.method == 'PUT' or data.get('id'):
        flight = Flight.query.get(data.get('id'))
        if not flight:
            return jsonify({'error': 'Рейс не найден'}), 404
    else:
        flight = Flight()
        db.session.add(flight)
    flight.flight_number = data['flight_number']
    flight.airline = data['airline']
    flight.from_airport_id = from_ap.id
    flight.to_airport_id = to_ap.id
    flight.departure_time = data['departure_time']
    flight.arrival_time = data['arrival_time']
    flight.duration = data['duration']
    flight.base_price = float(data['base_price'])
    flight.seats_eco = int(data.get('seats_eco', 0))
    flight.seats_mid = int(data.get('seats_mid', 0))
    flight.seats_biz = int(data.get('seats_biz', 0))
    flight.status = data.get('status', 'active')
    db.session.commit()
    return jsonify({'success': True, 'id': flight.id})


@app.route('/api/admin/flights/<int:flight_id>', methods=['DELETE'])
@login_required
def delete_flight(flight_id):
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    flight = Flight.query.get(flight_id)
    if not flight:
        return jsonify({'error': 'Рейс не найден'}), 404
    if Booking.query.filter_by(flight_id=flight_id).count() > 0:
        flight.status = 'cancelled'
        db.session.commit()
        return jsonify({'success': True, 'message': 'Рейс отменён (есть бронирования)'})
    db.session.delete(flight)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/admin/airports', methods=['GET', 'POST', 'PUT'])
@login_required
def manage_airports():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    if request.method == 'GET':
        return jsonify([{
            'code': a.code, 'name': a.name, 'city': a.city,
            'country': a.country.name if a.country else '',
        } for a in Airport.query.all()])
    data = request.get_json() or {}
    country = Country.query.filter_by(name=data.get('country')).first()
    if not country:
        country = Country(name=data['country'])
        db.session.add(country)
        db.session.flush()
    if request.method == 'PUT':
        airport = Airport.query.filter_by(code=data.get('code', '').upper()).first()
        if not airport:
            return jsonify({'error': 'Аэропорт не найден'}), 404
        airport.name = data['name']
        airport.city = data['city']
        airport.country_id = country.id
    else:
        code = data.get('code', '').upper()
        if Airport.query.filter_by(code=code).first():
            return jsonify({'error': 'Аэропорт с таким кодом уже существует'}), 400
        airport = Airport(code=code, name=data['name'], city=data['city'], country_id=country.id)
        db.session.add(airport)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/admin/users')
@login_required
def admin_users():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    return jsonify([{
        'id': u.id, 'name': u.username, 'email': u.email,
        'is_admin': u.is_admin, 'bookings_count': len(u.bookings),
        'confirmed': u.email_confirmed,
    } for u in User.query.all()])


@app.route('/api/admin/bookings')
@login_required
def admin_bookings():
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    result = []
    for b in Booking.query.order_by(Booking.created_at.desc()).all():
        if b.flight:
            d = booking_to_dict(b)
            d['passenger_name'] = b.passenger_name
            result.append(d)
    return jsonify(result)


@app.route('/api/admin/airports/<code>', methods=['DELETE'])
@login_required
def delete_airport(code):
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    airport = Airport.query.filter_by(code=code).first()
    if not airport:
        return jsonify({'error': 'Аэропорт не найден'}), 404
    flights_count = Flight.query.filter(
        (Flight.from_airport_id == airport.id) | (Flight.to_airport_id == airport.id)
    ).count()
    if flights_count > 0:
        return jsonify({'error': 'Невозможно удалить: аэропорт используется в рейсах'}), 400
    db.session.delete(airport)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    if user_id == current_user.id:
        return jsonify({'error': 'Нельзя удалить самого себя'}), 400
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    Booking.query.filter_by(user_id=user_id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/admin/bookings/<int:booking_id>', methods=['DELETE'])
@login_required
def delete_booking(booking_id):
    if not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    booking = Booking.query.get(booking_id)
    if not booking:
        return jsonify({'error': 'Бронирование не найдено'}), 404
    db.session.delete(booking)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/bookings/<int:booking_id>')
@login_required
def get_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)
    if booking.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    return jsonify(booking_to_dict(booking))


@app.route('/api/bookings/<int:booking_id>', methods=['PUT'])
@login_required
def edit_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)
    if booking.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    if not booking.can_edit():
        return jsonify({'error': 'Редактирование недоступно (менее 12 часов до вылета)'}), 400
    data = request.get_json() or {}
    new_services = [s for s in data.get('services', []) if s in SERVICE_PRICES]
    passengers = getattr(booking, 'passengers', 1) or 1
    new_total = calculate_total(booking.flight, booking.flight_class, new_services, passengers)
    booking.services = ','.join(new_services)
    booking.total_price = new_total
    db.session.commit()
    return jsonify({'success': True, 'new_total': new_total})


@app.route('/api/bookings/<int:booking_id>', methods=['DELETE'])
@login_required
def cancel_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)
    if booking.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Forbidden'}), 403
    db.session.delete(booking)
    db.session.commit()
    return jsonify({'success': True})


def migrate_db():
    from sqlalchemy import text
    for sql in (
        "ALTER TABLE booking ADD COLUMN passengers INTEGER DEFAULT 1",
        "ALTER TABLE booking ADD COLUMN return_date DATE",
        "ALTER TABLE user ADD COLUMN phone VARCHAR(50)",
        "ALTER TABLE user ADD COLUMN avatar_color VARCHAR(20) DEFAULT '#1e90d4'",
        "ALTER TABLE user ADD COLUMN currency VARCHAR(10) DEFAULT 'EUR'",
    ):
        try:
            db.session.execute(text(sql))
            db.session.commit()
        except Exception:
            db.session.rollback()


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        migrate_db()
    app.run(debug=False, host='0.0.0.0', port=5000)
