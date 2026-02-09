# Firebase (Realtime Database)

1) Activer **Realtime Database** dans Firebase.
2) Coller les règles du fichier `database.rules.json`.
3) Créer au moins un utilisateur (Firebase Auth) email/password.

Chemins :

- Multi-maisons :

	- `users/<uid>/homeId` = ex: `"homeA"`
	- `homes/<homeId>/commands/lamp/state` = `"ON"` ou `"OFF"`
	- `homes/<homeId>/commands/lamp/timestamp` = ISO 8601
	- `homes/<homeId>/measurements/<ISO_TIMESTAMP>/...`

Pour associer un compte à une maison :

Option A (simple, recommandé) : depuis le dashboard Web

1) L'utilisateur se connecte sur le dashboard.
2) S'il n'a pas encore de maison, il saisit le `HOME_ID` (ex: `homeA`) et clique sur **Associer**.

Cela écrit automatiquement :

`users/<uid>/homeId = "homeA"`

Note : avec les règles actuelles, ce `homeId` n'est pas modifiable depuis le dashboard (il faut supprimer la valeur côté Firebase si tu veux réassocier).

Option B : manuellement dans la console Firebase

1) Va dans **Firebase Console → Authentication**, copie le `uid` du compte.
2) Va dans **Realtime Database → Data** et crée :

`users/<uid>/homeId = "homeA"` (ou autre)
