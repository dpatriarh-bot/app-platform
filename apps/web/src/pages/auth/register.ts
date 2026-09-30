// ============================================================
// pages/auth/register.ts — регистрация родителя и ребёнка
// + капча.
// ============================================================

import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import {
  field,
  passwordField,
  selectField,
  checkboxField,
  form,
  type FieldHandle,
  type SelectHandle,
} from '../../components/form.js';
import { captchaField, type CaptchaHandle } from '../../components/captcha.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import {
  validatePhone,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
  validateFullName,
  validateBirthDate,
} from '../../lib/validation.js';
import { setRoot } from '../../components/layout.js';

const PRICE_RUB = 190;

export async function renderRegister(): Promise<void> {
  const parentName = field({
    name: 'fullName',
    label: 'ФИО родителя',
    required: true,
    placeholder: 'Иванова Мария Петровна',
    autocomplete: 'name',
    validate: validateFullName,
  });

  const phone = field({
    name: 'phone',
    label: 'Телефон',
    type: 'tel',
    required: true,
    placeholder: '+7 (___) ___-__-__',
    autocomplete: 'tel',
    inputMode: 'tel',
    validate: validatePhone,
    hint: 'Используется как логин',
  });

  const email = field({
    name: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    placeholder: 'mail@example.com',
    autocomplete: 'email',
    inputMode: 'email',
    validate: validateEmail,
  });

  const password = passwordField({
    name: 'password',
    label: 'Пароль',
    required: true,
    autocomplete: 'new-password',
    validate: validatePassword,
    hint: 'Минимум 8 символов, латинские буквы и цифры',
  });

  const passwordConfirm = passwordField({
    name: 'passwordConfirm',
    label: 'Повторите пароль',
    required: true,
    autocomplete: 'new-password',
    validate: (v) => validatePasswordConfirm(password.getValue(), v),
  });

  const childName = field({
    name: 'child.fullName',
    label: 'ФИО ребёнка',
    required: true,
    placeholder: 'Иванов Пётр Сергеевич',
    validate: validateFullName,
  });

  const childBirthDate = field({
    name: 'child.birthDate',
    label: 'Дата рождения',
    type: 'date',
    required: true,
    validate: validateBirthDate,
  });

  const childCity = field({
    name: 'child.city',
    label: 'Город',
    placeholder: 'Москва',
    autocomplete: 'address-level2',
  });

  const childSchool = field({
    name: 'child.school',
    label: 'Школа',
    placeholder: 'ГБОУ Школа №1234',
  });

  const childGrade = selectField({
    name: 'child.grade',
    label: 'Класс',
    required: true,
    placeholder: 'Выберите класс',
    options: Array.from({ length: 11 }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1} класс`,
    })),
  });

  const consent = checkboxField({
    name: 'consent',
    label: '',
    required: true,
    errorMessage: 'Необходимо согласие с офертой',
  });

  const consentLabel = consent.root.querySelector('.check span:last-child');
  if (consentLabel) {
    consentLabel.replaceChildren(
      h('span', null, 'Я согласен с '),
      h('a', { href: '#/about', target: '_blank' }, 'офертой'),
      h('span', null, ' и '),
      h('a', { href: '#/about', target: '_blank' }, 'политикой конфиденциальности'),
      h('span', { class: 'text-danger' }, ' *')
    );
  }

  const captcha: CaptchaHandle = await captchaField();

  const f = form({
    fields: [
      h('h5', { style: 'margin-bottom:4px;' }, 'Данные родителя'),
      parentName.root,
      phone.root,
      email.root,
      password.root,
      passwordConfirm.root,

      h('div', { class: 'divider' }),
      h('h5', { style: 'margin-bottom:4px;' }, 'Данные ребёнка'),
      childName.root,
      childBirthDate.root,
      childCity.root,
      childSchool.root,
      childGrade.root,

      h('div', { class: 'divider' }),
      consent.root,

      captcha.root,

      h('div', { class: 'alert alert-info' },
        icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, `Стоимость подписки — ${PRICE_RUB} ₽ / месяц`),
          'Оплата картой через защищённый шлюз. Начать можно без оплаты.'
        )
      ),

      h('div', { class: 'alert alert-success' },
        icon('heart', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, '80% — на благотворительность'),
          'Мы перечисляем 80% от каждой оплаты подписки в фонд «Улыбка детям».'
        )
      ),
    ],
    submitLabel: 'Зарегистрироваться',
    onSubmit: async () => {
      const valid =
        parentName.validate() &&
        phone.validate() &&
        email.validate() &&
        password.validate() &&
        passwordConfirm.validate() &&
        childName.validate() &&
        childBirthDate.validate() &&
        childGrade.validate() &&
        consent.validate();

      if (!valid) {
        f.setSubmitError('Проверьте правильность заполнения полей');
        return;
      }

      f.setSubmitError(null);

      try {
        const res = await api.post<{
          user: {
            id: string;
            role: 'parent' | 'manager' | 'curator' | 'admin' | 'superadmin';
            status: string;
            phone: string;
            email: string | null;
            totpEnabled: boolean;
            consentVersion: string | null;
          };
          consentUpdateRequired: boolean;
        }>('/auth/register', {
          fullName: parentName.getValue(),
          phone: phone.getValue(),
          email: email.getValue(),
          password: password.getValue(),
          passwordConfirm: passwordConfirm.getValue(),
          child: {
            fullName: childName.getValue(),
            birthDate: childBirthDate.getValue(),
            city: childCity.getValue(),
            school: childSchool.getValue(),
            grade: Number(childGrade.getValue()),
          },
          consent: true,
          captchaToken: captcha.getToken() ?? undefined,
        });

        store.setState({ user: res.user });
        toastSuccess('Аккаунт создан!');
        router.navigate('/app');
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 422 && err.details && typeof err.details === 'object') {
            const details = err.details as { fields?: Record<string, string> };
            if (details.fields) {
              applyFieldErrors(details.fields, {
                fullName: parentName,
                phone,
                email,
                password,
                passwordConfirm,
                'child.fullName': childName,
                'child.birthDate': childBirthDate,
                'child.city': childCity,
                'child.school': childSchool,
                'child.grade': childGrade,
              });
            }
          }
          if (err.code === 'CAPTCHA_FAILED') {
            captcha.reset();
          }
          f.setSubmitError(err.message);
          toastError(err.message);
        } else {
          f.setSubmitError('Не удалось создать аккаунт. Проверьте соединение.');
        }
      }
    },
    secondaryAction: h('div', { class: 'text-center text-sm text-muted' },
      'Уже есть аккаунт? ',
      h('a', { href: '#/login' }, 'Войти')
    ),
  });

  const content = h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
    h('div', { style: 'width:100%;max-width:520px;' },
      h('div', { class: 'text-center mb-6' },
        h('a', { href: '#/' },
          h('img', {
            src: '/logo.svg',
            alt: '',
            style: 'width:56px;height:56px;border-radius:14px;margin:0 auto 12px;',
          })
        ),
        h('h2', null, 'Регистрация'),
        h('p', { class: 'text-muted text-sm mt-2' }, 'Создайте аккаунт родителя и добавьте ребёнка')
      ),
      h('div', { class: 'card card-pad-lg' }, f.root)
    )
  );

  setRoot(content);
  parentName.input.focus();
}

function applyFieldErrors(
  fields: Record<string, string>,
  handles: Record<string, FieldHandle | SelectHandle | { setError: (msg: string | null) => void }>
): void {
  for (const [name, message] of Object.entries(fields)) {
    const handle = handles[name];
    if (handle) {
      handle.setError(message);
    }
  }
}